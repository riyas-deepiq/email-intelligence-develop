#!/bin/sh
# ============================================================================
# insight-hub-server — post-remove  (deb postrm / rpm %postun)
#
#   dpkg   postrm remove | purge | upgrade <ver> | abort-* | disappear
#   rpm    %postun 0   — last copy removed
#          %postun 1   — upgrade
#
# The two formats do not agree on what "removal" means, so this script does not
# pretend they do:
#
#   * dpkg keeps conffiles on `remove` and deletes them on `purge`. So `remove`
#     leaves the configuration and the generated secrets in place — reinstalling
#     picks up exactly where it left off.
#   * rpm has no purge. On removal it deletes %config(noreplace) files that were
#     never edited — which, by design, ours never are — so the generated
#     secrets.env is cleaned up there too, rather than being left orphaned
#     beside a config file that no longer exists.
#
# NEITHER path deletes /var/lib/insight-hub. Following postgresql-common,
# a package removal does not destroy accumulated data: it says where the data is
# and leaves the decision to the administrator. The PostgreSQL database is never
# touched either way.
# ============================================================================
set -e

SERVICE_USER="email-intel"
CONF="/etc/insight-hub"
DATA="/var/lib/insight-hub"
LOGS="/var/log/insight-hub"

reload_systemd() {
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload >/dev/null 2>&1 || true
        systemctl reset-failed insight-hub >/dev/null 2>&1 || true
    fi
}

# Generated, not packaged — no package manager will ever remove these for us.
drop_generated() {
    rm -f "$CONF/server/secrets.env"
    rm -f "$LOGS/install-config.log"
}

# The account is shared with the collector package. Only the last one out
# removes it.
drop_user_if_unused() {
    if [ ! -x /usr/bin/insight-hub-collector ] && getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
        userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    fi
}

case "${1:-remove}" in
    purge)
        drop_generated
        rm -rf "$CONF/server" "$CONF/client"
        rmdir "$CONF" 2>/dev/null || true
        rmdir "$LOGS" 2>/dev/null || true
        drop_user_if_unused
        reload_systemd
        if [ -d "$DATA" ]; then
            cat >&2 <<EOF

Configuration removed. Uploads and backups were NOT deleted:

    $DATA

Remove them yourself if you no longer need them. The PostgreSQL database was
not touched.
EOF
        fi
        ;;

    remove)
        # dpkg: conffiles survive until purge, so the secrets must survive too.
        reload_systemd
        ;;

    0)
        # rpm final removal.
        drop_generated
        rmdir "$CONF/server" "$CONF/client" "$CONF" "$LOGS" 2>/dev/null || true
        drop_user_if_unused
        reload_systemd
        if [ -d "$DATA" ]; then
            echo "Uploads and backups kept at $DATA. The PostgreSQL database was not touched." >&2
        fi
        ;;

    upgrade|1|failed-upgrade|abort-install|abort-upgrade|disappear)
        ;;
esac

exit 0
