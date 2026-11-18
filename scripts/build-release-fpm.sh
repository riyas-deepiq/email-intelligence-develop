#!/usr/bin/env bash
# ============================================================================
# Builds native Linux packages with FPM: .deb and .rpm, for both roles.
#
#   ./scripts/build-release-fpm.sh --version 1.0.0
#
# Produces four artifacts in release/linux/packages/:
#
#   insight-hub-server_1.0.0-1_amd64.deb
#   insight-hub-server-1.0.0-1.x86_64.rpm
#   insight-hub-collector_1.0.0-1_amd64.deb
#   insight-hub-collector-1.0.0-1.x86_64.rpm
#
# This is the closest Linux equivalent of installer/windows/insight-hub.iss:
# one description of the payload, compiled twice per role, with install-time
# behaviour in maintainer scripts instead of Inno's [Code] section.
#
# A native package hands upgrade, removal, config-file preservation, dependency
# checking and integrity verification to the package manager, instead of
# reimplementing each one in shell.
#
# REQUIREMENTS
#   node          builds the three packages — runs anywhere
#   fpm           gem install fpm   (needs Ruby)
#   rpmbuild      only for the .rpm targets (rpm / rpm-build)
#   dpkg-deb      only for the .deb targets (dpkg-dev)
#   a Linux host  — for the packaging step only
#
# The BINARIES cross-build from any host, Windows included, because the tree has
# no native dependency (argon2 was replaced with hash-wasm). Use --binaries-only
# to build just those on a Windows machine and package them elsewhere.
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="1.0.0"
ITERATION="1"
SKIP_BUILD=0
BINARIES_ONLY=0
FORMATS="deb rpm"

MAINTAINER="RZDigital.net <support@rzdigital.net>"
VENDOR="RZDigital.net"
LICENSE="Proprietary"
URL="https://rzdigital.net"

while [ $# -gt 0 ]; do
    case "$1" in
        --version)   VERSION="${2:-}"; shift 2 ;;
        --iteration) ITERATION="${2:-}"; shift 2 ;;
        --skip-build) SKIP_BUILD=1; shift ;;
        --binaries-only) BINARIES_ONLY=1; shift ;;
        --deb-only)  FORMATS="deb"; shift ;;
        --rpm-only)  FORMATS="rpm"; shift ;;
        -h|--help)
            echo "usage: $0 [--version X.Y.Z] [--iteration N] [--skip-build]"
            echo "          [--binaries-only] [--deb-only|--rpm-only]"
            exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
    || { echo "--version must be a release version such as 1.2.3 or 1.2.3-rc.1" >&2; exit 2; }
[[ "$ITERATION" =~ ^[1-9][0-9]*$ ]] \
    || { echo "--iteration must be a positive integer" >&2; exit 2; }

step() { printf '\n\033[36m=== %s ===\033[0m\n' "$*"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

RELEASE="$REPO_ROOT/release/linux"
OUT="$RELEASE/packages"
STAGING="$REPO_ROOT/installer/fpm/staging"
SRC="$REPO_ROOT/installer/fpm"

# ── Prerequisites ────────────────────────────────────────────────────────────
# Node is checked unconditionally; the packaging toolchain only when we are
# actually going to package. That ordering is what lets --binaries-only run on a
# Windows machine, which is the whole point of having no native dependency.
step "Checking prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js is not on PATH."
ok "node $(node -v)"

if [ "$BINARIES_ONLY" -eq 0 ]; then
    [ "$(uname -s)" = "Linux" ] || die \
"Package building needs a Linux host — fpm shells out to dpkg-deb and rpmbuild.
 The binaries themselves cross-build anywhere: re-run with --binaries-only here,
 then package on Linux with --skip-build. Or use WSL or a container."

    command -v fpm >/dev/null 2>&1 || die \
"fpm not found. Install it:
   sudo apt install ruby ruby-dev build-essential && sudo gem install fpm
   sudo dnf install ruby ruby-devel @development-tools && sudo gem install fpm"
    ok "fpm $(fpm --version 2>/dev/null || echo '?')"

    case " $FORMATS " in
        *" deb "*) command -v dpkg-deb >/dev/null 2>&1 || die "dpkg-deb not found (apt install dpkg-dev), or pass --rpm-only." ;;
    esac
    case " $FORMATS " in
        *" rpm "*) command -v rpmbuild >/dev/null 2>&1 || die "rpmbuild not found (apt install rpm / dnf install rpm-build), or pass --deb-only." ;;
    esac
fi

# ── Build the binaries ───────────────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 1 ]; then
    step "Skipping the build (--skip-build)"
else
    # The client must be built before the server: package:linux copies
    # client/dist into server/public and embeds it in the executable.
    step "Building web client";          npm --prefix "$REPO_ROOT/client" run build
    step "Building server executable";   npm --prefix "$REPO_ROOT/server" run package:linux
    step "Building collector executable"; npm --prefix "$REPO_ROOT/collector" run package:linux
fi

for b in insight-hub-server insight-hub-collector; do
    [ -f "$RELEASE/$b" ] || die "Expected build output missing: $RELEASE/$b (drop --skip-build)"
done

if [ "$BINARIES_ONLY" -eq 1 ]; then
    step "Binaries only (--binaries-only)"
    ls -lh "$RELEASE"/insight-hub-* | awk '{ printf "  %-52s %s\n", $9, $5 }'
    cat <<EOF

Copy these to a Linux host and package there:
  ./scripts/build-release-fpm.sh --version $VERSION --skip-build

Note: a binary built on Windows arrives WITHOUT the execute bit — NTFS cannot
store one. The staging step uses 'install -m 0755' rather than 'cp' for exactly
this reason, so the packages come out correct either way.
EOF
    exit 0
fi

mkdir -p "$OUT"

# ── Stage and package, one role at a time ────────────────────────────────────
for role in server collector; do
    PKG="insight-hub-$role"
    STAGE="$STAGING/$role"

    step "Staging $PKG"
    rm -rf "$STAGE"

    # The staging tree IS the installed filesystem. What you see here is exactly
    # what lands on the target — no prefix substitution anywhere, which is the
    # whole reason the systemd units can be shipped verbatim.
    install -d -m 0755 "$STAGE/usr/bin"
    install -d -m 0755 "$STAGE/usr/lib/systemd/system"
    install -d -m 0755 "$STAGE/usr/lib/insight-hub/$role"
    install -d -m 0755 "$STAGE/usr/share/doc/$PKG"
    install -d -m 0750 "$STAGE/etc/insight-hub"

    # 0755 explicitly: a binary built on Windows arrives without the execute bit,
    # and `install -m` is the only copy that reliably sets it.
    install -m 0755 "$RELEASE/$PKG" "$STAGE/usr/bin/$PKG"
    install -m 0755 "$SRC/lib/finalize-config.sh" "$STAGE/usr/lib/insight-hub/$role/finalize-config.sh"
    install -m 0644 "$SRC/README.md" "$STAGE/usr/share/doc/$PKG/README.md"

    if [ "$role" = "server" ]; then
        install -d -m 0750 "$STAGE/etc/insight-hub/server"
        install -d -m 0750 "$STAGE/etc/insight-hub/client"
        install -m 0640 "$SRC/config/server.env" "$STAGE/etc/insight-hub/server/.env"
        # Served to the browser; nothing secret belongs in it.
        install -m 0644 "$SRC/config/client.env" "$STAGE/etc/insight-hub/client/.env"
        install -m 0644 "$SRC/systemd/insight-hub.service" \
                        "$STAGE/usr/lib/systemd/system/insight-hub.service"
        CONFIG_FILES=(/etc/insight-hub/server/.env /etc/insight-hub/client/.env)
        DESCRIPTION="Insight Hub server
REST API and web interface for mailbox intelligence across Microsoft 365 and
Google Workspace. Serves the web application and coordinates collectors."
    else
        install -d -m 0750 "$STAGE/etc/insight-hub/collector1"
        install -m 0640 "$SRC/config/collector.env" "$STAGE/etc/insight-hub/collector1/.env"
        install -m 0644 "$SRC/systemd/insight-hub-collector@.service" \
                        "$STAGE/usr/lib/systemd/system/insight-hub-collector@.service"
        install -m 0755 "$SRC/lib/add-collector.sh"    "$STAGE/usr/lib/insight-hub/collector/add-collector.sh"
        install -m 0755 "$SRC/lib/remove-collector.sh" "$STAGE/usr/lib/insight-hub/collector/remove-collector.sh"
        CONFIG_FILES=(/etc/insight-hub/collector1/.env)
        DESCRIPTION="Insight Hub collector
Pulls mailbox sync jobs from an Insight Hub server and ingests mail from
Microsoft 365 and Google Workspace. Runs as a systemd template unit, so several
instances can share one installation."
    fi

    ok "$(du -sh "$STAGE" | cut -f1) staged"

    CONF_ARGS=()
    for c in "${CONFIG_FILES[@]}"; do CONF_ARGS+=(--config-files "$c"); done

    for fmt in $FORMATS; do
        if [ "$fmt" = "deb" ]; then
            ARCH="amd64"; DEPS=(--depends systemd)
        else
            ARCH="x86_64"; DEPS=(--depends systemd --depends shadow-utils)
        fi

        step "Building the $role .$fmt"
        # --force so a rebuild at the same version overwrites rather than aborting.
        fpm -s dir -t "$fmt" -C "$STAGE" \
            -n "$PKG" -a "$ARCH" \
            --version "$VERSION" --iteration "$ITERATION" \
            --maintainer "$MAINTAINER" --vendor "$VENDOR" \
            --license "$LICENSE" --url "$URL" --category net \
            --description "$DESCRIPTION" \
            "${DEPS[@]}" \
            "${CONF_ARGS[@]}" \
            --after-install "$SRC/scripts/$role-postinstall.sh" \
            --before-remove "$SRC/scripts/$role-preremove.sh" \
            --after-remove  "$SRC/scripts/$role-postremove.sh" \
            --package "$OUT" \
            --force \
            .
        ok "$fmt built"
    done
done

# ── Checksums ────────────────────────────────────────────────────────────────
step "Artifacts"
( cd "$OUT" && sha256sum ./*.deb ./*.rpm 2>/dev/null >SHA256SUMS || true )
ls -lh "$OUT" | tail -n +2 | awk '{ printf "  %-56s %s\n", $9, $5 }'

cat <<EOF

Install:
  sudo apt install ./insight-hub-server_${VERSION}-${ITERATION}_amd64.deb
  sudo dnf install ./insight-hub-server-${VERSION}-${ITERATION}.x86_64.rpm

Add the collector on the same machine (any order) — it adopts the server's
secret automatically:
  sudo apt install ./insight-hub-collector_${VERSION}-${ITERATION}_amd64.deb

Inspect before installing:
  dpkg-deb -c  insight-hub-server_${VERSION}-${ITERATION}_amd64.deb
  dpkg-deb -I  insight-hub-server_${VERSION}-${ITERATION}_amd64.deb
  rpm -qlp     insight-hub-server-${VERSION}-${ITERATION}.x86_64.rpm
  rpm -qp --scripts insight-hub-server-${VERSION}-${ITERATION}.x86_64.rpm

Reminder: sign the packages before publishing them.
  dpkg-sig --sign builder *.deb
  rpm --addsign *.rpm
EOF
