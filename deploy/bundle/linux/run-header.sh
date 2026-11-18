#!/bin/sh
# ============================================================================
# Insight Hub @VERSION@ — self-extracting container installer (@ROLE@ role)
#
# Container images, Compose topology, configuration and installer logic are in
# this file, so the target never needs a container registry. The RAG role still
# needs model-registry access on first boot unless its Ollama volume was seeded.
#
#   sudo ./insight-hub-@ROLE@-@VERSION@.run                 install
#   sudo ./insight-hub-@ROLE@-@VERSION@.run --extract DIR   unpack only
#   ./insight-hub-@ROLE@-@VERSION@.run --check              verify checksums
#
# Anything after `--` is passed through to install.sh, which is how the
# collector receives its server URL and shared secret:
#
#   sudo ./insight-hub-collector-@VERSION@.run -- \
#        --server-url http://insight-hub-server:8080 --collector-secret <value>
#
#   sudo ./insight-hub-rag-@VERSION@.run -- \
#        --server-url http://insight-hub-server:8080 \
#        --postgres-url postgresql+psycopg2://... --rag-secret <value>
# ============================================================================
set -eu

VERSION="@VERSION@"
ROLE="@ROLE@"
MODE="install"
EXTRACT_DIR=""
PASSTHRU=""

while [ $# -gt 0 ]; do
    case "$1" in
        --extract) MODE="extract"; EXTRACT_DIR="${2:?--extract needs a directory}"; shift 2 ;;
        --check)   MODE="check"; shift ;;
        --)        shift; PASSTHRU="$*"; break ;;
        -h|--help)
            sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) PASSTHRU="$PASSTHRU $1"; shift ;;
    esac
done

# The payload begins on the line after the marker. Keep __PAYLOAD_BELOW__ as the
# final line of this header — the offset is computed from it.
PAYLOAD_LINE=$(awk '/^__PAYLOAD_BELOW__$/ { print NR + 1; exit 0; }' "$0")
[ -n "$PAYLOAD_LINE" ] || { echo "error: payload marker not found — file is corrupt" >&2; exit 1; }

if [ "$MODE" = "extract" ]; then
    mkdir -p "$EXTRACT_DIR"
    tail -n +"$PAYLOAD_LINE" "$0" | tar xz -C "$EXTRACT_DIR"
    echo "Extracted to $EXTRACT_DIR"
    exit 0
fi

WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT INT TERM

echo "Insight Hub $VERSION ($ROLE) — unpacking..."
tail -n +"$PAYLOAD_LINE" "$0" | tar xz -C "$WORKDIR"

if [ -f "$WORKDIR/SHA256SUMS" ] && command -v sha256sum >/dev/null 2>&1; then
    echo "Verifying integrity..."
    ( cd "$WORKDIR" && sha256sum --quiet --check SHA256SUMS ) || {
        echo "error: checksum verification FAILED — do not install this file" >&2
        exit 1
    }
    echo "Integrity OK."
fi

if [ "$MODE" = "check" ]; then
    cat "$WORKDIR/MANIFEST"
    exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "error: run as root (sudo) — the installer registers a system service" >&2
    exit 1
fi

# shellcheck disable=SC2086
exec sh "$WORKDIR/install.sh" \
    --bundle-dir "$WORKDIR" --version "$VERSION" --role "$ROLE" $PASSTHRU

__PAYLOAD_BELOW__
