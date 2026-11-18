#!/bin/sh
# ============================================================================
# insight-hub-server — post-install  (deb postinst / rpm %post)
#
# fpm hands the same file to both formats, but they call it differently:
#
#   dpkg   postinst configure [<old-version>]     — old-version empty on install
#   rpm    %post 1                                — install
#          %post 2                                — upgrade
#
# So the first job of this script is to work out which of the two it is, and
# whether this is a fresh install or an upgrade. Everything after that is
# format-agnostic.
# ============================================================================
set -e

SERVICE_USER="email-intel"
CONF="/etc/insight-hub"
DATA="/var/lib/insight-hub"
LOGS="/var/log/insight-hub"
LIB="/usr/lib/insight-hub/server"
UNIT="insight-hub"

IS_UPGRADE=0
case "${1:-configure}" in
    configure)                       # dpkg
        if [ -n "${2:-}" ]; then IS_UPGRADE=1; fi ;;
    1) ;;                            # rpm install
    2) IS_UPGRADE=1 ;;               # rpm upgrade
    abort-upgrade|abort-remove|abort-deconfigure|triggered)
        exit 0 ;;
    *)  exit 0 ;;
esac

# ── Service account ──────────────────────────────────────────────────────────
# A system account with no login shell and no home directory: it exists only to
# own the files and run the units. Shared with the collector package, so both
# create it and neither removes it while the other is installed.
if ! getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
    NOLOGIN=/usr/sbin/nologin
    [ -x "$NOLOGIN" ] || NOLOGIN=/sbin/nologin
    [ -x "$NOLOGIN" ] || NOLOGIN=/bin/false
    useradd --system --no-create-home --shell "$NOLOGIN" \
            --comment "Insight Hub service account" "$SERVICE_USER" || true
fi

# ── Directories the package cannot ship pre-owned ────────────────────────────
mkdir -p "$DATA/uploads" "$DATA/backups" "$DATA/temp" "$LOGS"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA" "$LOGS"
chmod 0750 "$DATA" "$LOGS"

# Config is 0640 root:email-intel — readable by the service, not by every local
# user, which matters because it holds the database password. (The Windows side
# still leaves its config readable by local users; this is stricter on purpose.)
chown -R "root:$SERVICE_USER" "$CONF" 2>/dev/null || true
chmod 0750 "$CONF" "$CONF/server" "$CONF/client" 2>/dev/null || true
chmod 0640 "$CONF/server/.env" 2>/dev/null || true
# Served to the browser; nothing secret belongs in it.
chmod 0644 "$CONF/client/.env" 2>/dev/null || true

# ── Secrets, joining a collector, firewall ───────────────────────────────────
if [ -x "$LIB/finalize-config.sh" ]; then
    "$LIB/finalize-config.sh" --role server --user "$SERVICE_USER" || \
        echo "insight-hub: finalize-config.sh failed — see $LOGS/install-config.log" >&2
fi

# ── systemd ──────────────────────────────────────────────────────────────────
# /run/systemd/system exists only when systemd is the running init. Without this
# guard the package fails to install in a container or a chroot.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
    systemctl enable "$UNIT" >/dev/null 2>&1 || true

    if [ "$IS_UPGRADE" -eq 1 ]; then
        systemctl try-restart "$UNIT" || true
    else
        systemctl start "$UNIT" || true
    fi

    # ── Verify ───────────────────────────────────────────────────────────────
    # A started unit is not a working product. The server exits when it cannot
    # reach PostgreSQL, so gate on the health endpoint and say what to fix,
    # rather than printing "done" over a dead service.
    PORT=$(sed -n -E 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "$CONF/server/.env" 2>/dev/null | head -1)
    [ -n "$PORT" ] || PORT=8080

    if /usr/bin/insight-hub-server health --port "$PORT" --timeout 45 >/dev/null 2>&1; then
        echo "Insight Hub is healthy — http://localhost:$PORT"
    else
        cat >&2 <<EOF

Insight Hub installed, but the server is not answering on port $PORT.

  Almost always DATABASE_URL — the server exits when PostgreSQL is unreachable.

    sudo nano $CONF/server/.env
    sudo systemctl restart $UNIT
    journalctl -u $UNIT -n 50 --no-pager
EOF
    fi
else
    echo "insight-hub: systemd is not running — the service was installed but not started." >&2
fi

exit 0
