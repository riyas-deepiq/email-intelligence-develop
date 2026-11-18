#!/bin/sh
# ============================================================================
# insight-hub-collector — pre-remove  (deb prerm / rpm %preun)
#
# Stops and disables EVERY instance, not just the one the package created.
# Instances 2..N were added with add-collector.sh and are not package files, so
# nothing else would ever clean up their enablement symlinks — leaving systemd
# trying to start units whose binary has just been deleted.
# ============================================================================
set -e

CONF="/etc/insight-hub"

case "${1:-remove}" in
    remove|purge|0)
        if [ -d /run/systemd/system ]; then
            for d in "$CONF"/collector*/; do
                [ -d "$d" ] || continue
                n=$(basename "$d"); n=${n#collector}
                systemctl disable --now "insight-hub-collector@$n" >/dev/null 2>&1 || true
            done
            # Belt and braces: catch any instance that was enabled without a
            # matching config directory.
            systemctl stop 'insight-hub-collector@*' >/dev/null 2>&1 || true
        fi
        ;;
    upgrade|1|deconfigure|failed-upgrade)
        ;;
esac

exit 0
