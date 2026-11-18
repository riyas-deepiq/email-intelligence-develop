#!/usr/bin/env bash
# ============================================================================
# Builds self-contained container installers for the published roles:
#
#   insight-hub-<version>.run
#   └── (self-extracts to)
#       ├── images/          saved container images (.tar)
#       ├── compose/         docker-compose.yml (images only, no build stanzas)
#       ├── config/          .env template
#       ├── SHA256SUMS       integrity manifest
#       └── install.sh       loads images, starts services, health-checks
#
#   ./deploy/bundle/build-bundle.sh --version 1.0.0
#
# Requires: docker (with compose v2), python3, tar, gzip, sha256sum.
# Run on Linux — `docker save` of Linux images needs a Linux daemon, and the
# self-extracting header is a POSIX shell script.
#
# The shipped compose file is derived directly from deploy/docker-compose.yml.
# Reading the source preserves `${...}` expressions so no build-time placeholder
# can become a customer secret.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"   # deploy/bundle/linux
BUNDLE_DIR="$(dirname -- "$SCRIPT_DIR")"                          # deploy/bundle  — shared files
REPO_ROOT="$(cd -- "$BUNDLE_DIR/../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"

# ── Roles ───────────────────────────────────────────────────────────────────
# One installer per container role. The server carries its own datastores, the
# collector reaches the server over SERVER_URL, and RAG reaches both the Core
# Server and its authoritative PostgreSQL database over operator-supplied URLs.
ROLES="server collector rag"
role_services() {
    case "$1" in
        server)    echo "postgres,redis,server" ;;
        collector) echo "collector" ;;
        rag)       echo "redis,qdrant,ollama,ollama-init,rag" ;;
        *) echo "unknown role: $1" >&2; exit 1 ;;
    esac
}
role_images() {
    case "$1" in
        server)    echo "insight-hub/server:$VERSION postgres:16.14-alpine3.24 redis:7.4.10-alpine" ;;
        collector) echo "insight-hub/collector:$VERSION" ;;
        rag)       echo "insight-hub/rag:$VERSION redis:7.4.10-alpine qdrant/qdrant:v1.19.0-unprivileged ollama/ollama:0.32.6" ;;
    esac
}

VERSION=""
OUTPUT_DIR="$REPO_ROOT/release/linux"
SKIP_BUILD=0
ONLY_ROLE=""

usage() {
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version)     VERSION="${2:?--version needs a value}"; shift 2 ;;
        --output)      OUTPUT_DIR="${2:?--output needs a value}"; shift 2 ;;
        --role)        ONLY_ROLE="${2:?--role needs a value}"; shift 2 ;;
        --skip-build)  SKIP_BUILD=1; shift ;;
        -h|--help)     usage 0 ;;
        *) echo "unknown argument: $1" >&2; usage 1 ;;
    esac
done

[ -n "$ONLY_ROLE" ] && ROLES="$ONLY_ROLE"

for role in $ROLES; do role_services "$role" >/dev/null; done

[ -n "$VERSION" ] || { echo "error: --version is required" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
    || { echo "error: --version must look like 1.2.3 or 1.2.3-rc.1" >&2; exit 1; }

for tool in docker python3 tar gzip sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not found" >&2; exit 1; }
done

# Compose validates the entire source file even when building one service. These
# values exist only in this build process; role files are derived from the raw
# YAML, so none can be written into a bundle.
export POSTGRES_PASSWORD=build-only
export JWT_SECRET=build-only-not-a-runtime-secret
export OIDC_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export COLLECTOR_SECRET=build-only-not-runtime
export RAG_INTERNAL_SECRET=build-only-not-runtime
export SEED_ADMIN_PASSWORD=build-only

docker compose -f "$DEPLOY_DIR/docker-compose.yml" config --quiet

echo "==> Building application images (tag $VERSION)"
if [ "$SKIP_BUILD" -eq 0 ]; then
    IMAGE_TAG="$VERSION" docker compose -f "$DEPLOY_DIR/docker-compose.yml" build $ROLES
fi

echo "==> Pulling stock images"
PULLED_IMAGES=""
for role in $ROLES; do
    for image in $(role_images "$role"); do
        case "$image" in insight-hub/*) continue ;; esac
        case " $PULLED_IMAGES " in *" $image "*) continue ;; esac
        docker pull "$image"
        PULLED_IMAGES="$PULLED_IMAGES $image"
    done
done

mkdir -p "$OUTPUT_DIR"

for ROLE in $ROLES; do
    echo
    echo "════ Building the $ROLE bundle ════"

    STAGE="$(mktemp -d)"
    mkdir -p "$STAGE/images" "$STAGE/compose" "$STAGE/config"

    echo "==> Saving images"
    IMAGES="$(role_images "$ROLE")"
    for image in $IMAGES; do
        name="$(echo "$image" | tr '/:' '__')"
        echo "    $image"
        docker save "$image" | gzip -1 > "$STAGE/images/$name.tar.gz"
    done

    echo "==> Deriving the $ROLE compose file"
    # Shared with build-bundle.ps1 — one implementation, so the two platforms
    # cannot ship different topologies for the same role.
    python3 "$BUNDLE_DIR/strip-build.py" \
        "$DEPLOY_DIR/docker-compose.yml" \
        "$STAGE/compose/docker-compose.yml" \
        "$VERSION" \
        --role "$ROLE" \
        --services "$(role_services "$ROLE")"

    echo "==> Staging config and installer"
    cp "$DEPLOY_DIR/.env.example" "$STAGE/config/.env.template"
    cp "$SCRIPT_DIR/install.sh"   "$STAGE/install.sh"
    chmod +x "$STAGE/install.sh"
    printf '%s\n' "$ROLE" > "$STAGE/ROLE"

    cat > "$STAGE/MANIFEST" <<EOF
product=InsightHub
role=$ROLE
version=$VERSION
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
    printf '%s\n' $IMAGES > "$STAGE/IMAGES"

    echo "==> Writing checksums"
    ( cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z \
        | xargs -0 sha256sum > SHA256SUMS )

    echo "==> Assembling the self-extracting installer"
    RUN_FILE="$OUTPUT_DIR/insight-hub-$ROLE-$VERSION.run"
    PAYLOAD="$(mktemp)"
    tar czf "$PAYLOAD" -C "$STAGE" .

    # Header + payload concatenated. The header locates the payload by line
    # number, which is why __PAYLOAD_BELOW__ must be its last line.
    sed -e "s/@VERSION@/$VERSION/g" -e "s/@ROLE@/$ROLE/g" \
        "$SCRIPT_DIR/run-header.sh" > "$RUN_FILE"
    cat "$PAYLOAD" >> "$RUN_FILE"
    rm -f "$PAYLOAD"
    rm -rf "$STAGE"
    chmod +x "$RUN_FILE"

    echo "Built: $RUN_FILE ($(du -h "$RUN_FILE" | cut -f1))"
done

echo
echo "Install on the target hosts (install the server before RAG):"
echo "  sudo ./insight-hub-server-$VERSION.run"
echo "  sudo ./insight-hub-collector-$VERSION.run --server-url http://<server>:8080"
echo "  sudo ./insight-hub-rag-$VERSION.run -- --server-url http://<server>:8080 --postgres-url <url> --rag-secret <value>"
