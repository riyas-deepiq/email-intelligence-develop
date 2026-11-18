#!/bin/sh
# ============================================================================
# insight-hub-collector — post-install  (deb postinst / rpm %post)
#
# Same dual-format argument handling as the server's; see that script for the
# conventions. The difference here is instances: the packaged unit is a systemd
# template, so an upgrade must restart every instance an administrator added
# with add-collector.sh, not just the one the package created.
# ============================================================================
set -e

SERVICE_USER="email-intel"
CONF="/etc/insight-hub"
DATA="/var/lib/insight-hub"
LOGS="/var/log/insight-hub"
LIB="/usr/lib/insight-hub/collector"

IS_UPGRADE=0
case "${1:-configure}" in
    configure)
        if [ -n "${2:-}" ]; then IS_UPGRADE=1; fi ;;
    1) ;;
    2) IS_UPGRADE=1 ;;
    abort-upgrade|abort-remove|abort-deconfigure|triggered)
        exit 0 ;;
    *)  exit 0 ;;
esac

# ── Service account ──────────────────────────────────────────────────────────
# Shared with the server package: both create it, neither removes it while the
# other is installed.
if ! getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
    NOLOGIN=/usr/sbin/nologin
    [ -x "$NOLOGIN" ] || NOLOGIN=/sbin/nologin
    [ -x "$NOLOGIN" ] || NOLOGIN=/bin/false
    useradd --system --no-create-home --shell "$NOLOGIN" \
            --comment "Insight Hub service account" "$SERVICE_USER" || true
fi

# A collector persists nothing, but the unit's WorkingDirectory and its logs
# still have to exist and be writable.
mkdir -p "$DATA/temp" "$LOGS"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA/temp" "$LOGS"
chmod 0750 "$LOGS"

chown -R "root:$SERVICE_USER" "$CONF" 2>/dev/null || true
chmod 0750 "$CONF" 2>/dev/null || true
for d in "$CONF"/collector*/; do
    [ -d "$d" ] || continue
    chmod 0750 "$d" 2>/dev/null || true
    chmod 0640 "$d/.env" 2>/dev/null || true
done

# ── Adopt the server's secret, or a join file ────────────────────────────────
if [ -x "$LIB/finalize-config.sh" ]; then
    "$LIB/finalize-config.sh" --role collector --user "$SERVICE_USER" || \
        echo "insight-hub-collector: finalize-config.sh failed — see $LOGS/install-config.log" >&2
fi

# ── systemd ──────────────────────────────────────────────────────────────────
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true

    if [ "$IS_UPGRADE" -eq 1 ]; then
        # Restart every configured instance — the binary just changed under all
        # of them. try-restart touches only the ones that are actually running.
        for d in "$CONF"/collector*/; do
            [ -d "$d" ] || continue
            n=$(basename "$d"); n=${n#collector}
            systemctl try-restart "insight-hub-collector@$n" >/dev/null 2>&1 || true
        done
    else
        systemctl enable --now "insight-hub-collector@1" >/dev/null 2>&1 || true
    fi

    sleep 2
    if systemctl is-active --quiet "insight-hub-collector@1"; then
        echo "Insight Hub collector instance 1 is running."
    else
        echo "insight-hub-collector@1 is not running — journalctl -u 'insight-hub-collector@1' -n 50 --no-pager" >&2
    fi
else
    echo "insight-hub-collector: systemd is not running — installed but not started." >&2
fi

# ── Tell the operator when it is installed but not connected ─────────────────
# A collector with no secret polls, is rejected 401, and looks healthy from
# outside. Saying so here is the difference between a five-minute fix and a
# afternoon of confusion.
SECRET=""
if [ -f "$CONF/collector1/secrets.env" ]; then
    SECRET=$(sed -n -E 's/^[[:space:]]*COLLECTOR_SECRET[[:space:]]*=[[:space:]]*(.*)$/\1/p' \
             "$CONF/collector1/secrets.env" | head -1)
fi
if [ -z "$SECRET" ] || [ "$SECRET" = "CHANGE_ME" ]; then
    cat >&2 <<EOF

The collector is installed but not yet connected to a server.

  Set SERVER_URL and COLLECTOR_SECRET — copy the secret from the server's
  /etc/insight-hub/server/secrets.env, the two must match exactly:

    sudo nano $CONF/collector1/secrets.env
    sudo systemctl restart insight-hub-collector@1

  To skip this on other machines, place a join file holding those two values at
  $CONF/collector-join.env before installing the package.
EOF
fi

exit 0
