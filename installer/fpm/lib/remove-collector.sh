#!/usr/bin/env bash
# ============================================================================
# Removes a collector instance added with add-collector.sh.
#
#   sudo /usr/lib/insight-hub/collector/remove-collector.sh 2
#   sudo /usr/lib/insight-hub/collector/remove-collector.sh 2 --keep-config
#
# Instance 1 is refused: it belongs to the package, and deleting it would leave
# the package installed with nothing to run. Remove the package instead:
#     sudo apt purge insight-hub-collector
#     sudo dnf remove insight-hub-collector
# ============================================================================
set -euo pipefail

CONF="/etc/insight-hub"
INSTANCE=""
KEEP_CONFIG=0

usage() { echo "usage: sudo $0 <instance 2-99> [--keep-config]" >&2; }

while [ $# -gt 0 ]; do
    case "$1" in
        --keep-config) KEEP_CONFIG=1; shift ;;
        -h|--help)     usage; exit 0 ;;
        *)             INSTANCE="$1"; shift ;;
    esac
done

[ -n "$INSTANCE" ] || { usage; exit 2; }
case "$INSTANCE" in ''|*[!0-9]*) usage; exit 2 ;; esac
[ "$INSTANCE" = "1" ] && {
    echo "Instance 1 belongs to the package. Remove the package instead:" >&2
    echo "  sudo apt purge insight-hub-collector   # or: dnf remove ..." >&2
    exit 2; }
[ "$INSTANCE" -ge 2 ] && [ "$INSTANCE" -le 99 ] || { usage; exit 2; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root — this disables a systemd unit." >&2; exit 1; }

UNIT="insight-hub-collector@$INSTANCE"
DIR="$CONF/collector$INSTANCE"

systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
echo "Stopped and disabled $UNIT"

if [ "$KEEP_CONFIG" -eq 1 ]; then
    echo "Kept $DIR (--keep-config). Re-enable with: systemctl enable --now $UNIT"
elif [ -d "$DIR" ]; then
    rm -rf "$DIR"
    echo "Removed $DIR"
fi
