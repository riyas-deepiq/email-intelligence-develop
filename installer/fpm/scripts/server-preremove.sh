#!/bin/sh
# ============================================================================
# insight-hub-server — pre-remove  (deb prerm / rpm %preun)
#
#   dpkg   prerm remove | upgrade <ver> | deconfigure | failed-upgrade
#   rpm    %preun 0   — last copy being removed
#          %preun 1   — upgrade, an new version is coming
#
# Stop and disable ONLY on a real removal. On an upgrade the post-install script
# restarts the service; stopping here as well would take the service down for
# the whole unpack instead of a moment.
# ============================================================================
set -e

UNIT="insight-hub"

case "${1:-remove}" in
    remove|purge|0)
        if [ -d /run/systemd/system ]; then
            systemctl stop "$UNIT" >/dev/null 2>&1 || true
            systemctl disable "$UNIT" >/dev/null 2>&1 || true
        fi
        ;;
    upgrade|1|deconfigure|failed-upgrade)
        ;;
esac

exit 0
