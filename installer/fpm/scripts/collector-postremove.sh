#!/bin/sh
# ============================================================================
# insight-hub-collector — post-remove  (deb postrm / rpm %postun)
#
# See the server's post-remove script for why dpkg's remove/purge split and
# rpm's single removal are handled separately.
#
# Extra wrinkle here: only /etc/insight-hub/collector1 is a package
# directory. Instances 2..N were created by add-collector.sh, so no package
# manager knows about them and they must be removed explicitly on purge.
# ============================================================================
set -e

SERVICE_USER="email-intel"
CONF="/etc/insight-hub"
LOGS="/var/log/insight-hub"

reload_systemd() {
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload >/dev/null 2>&1 || true
        systemctl reset-failed 'insight-hub-collector@*' >/dev/null 2>&1 || true
    fi
}

drop_generated() {
    for d in "$CONF"/collector*/; do
        [ -d "$d" ] || continue
        rm -f "$d/secrets.env"
    done
}

# Every instance directory, including ones add-collector.sh created.
drop_all_instances() {
    for d in "$CONF"/collector*/; do
        [ -d "$d" ] || continue
        rm -rf "$d"
    done
}

drop_user_if_unused() {
    if [ ! -x /usr/bin/insight-hub-server ] && getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
        userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    fi
}

case "${1:-remove}" in
    purge)
        drop_all_instances
        rmdir "$CONF" 2>/dev/null || true
        rmdir "$LOGS" 2>/dev/null || true
        drop_user_if_unused
        reload_systemd
        ;;

    remove)
        # dpkg keeps conffiles until purge; keep the secrets beside them so a
        # reinstall comes back already joined to its server.
        reload_systemd
        ;;

    0)
        # rpm final removal: it deletes the unmodified .env files itself, so the
        # generated secrets would otherwise be left orphaned.
        drop_generated
        drop_all_instances
        rmdir "$CONF" "$LOGS" 2>/dev/null || true
        drop_user_if_unused
        reload_systemd
        ;;

    upgrade|1|failed-upgrade|abort-install|abort-upgrade|disappear)
        ;;
esac

exit 0
