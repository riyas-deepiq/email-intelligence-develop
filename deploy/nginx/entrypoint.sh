#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Renders the nginx configuration from the environment, then hands off to the
# stock nginx entrypoint (which still runs its own /docker-entrypoint.d steps).
#
# Config is generated rather than shipped fixed because the two things an
# operator actually changes per site — which addresses may reach the internal
# collector API, and whether TLS is terminated here — are the two things a
# static nginx.conf cannot express.
#
#   INSIGHT_HUB_UPSTREAM        host:port of the app          (default server:3000)
#   INSIGHT_HUB_TLS_MODE        redirect | off                (default redirect)
#   INSIGHT_HUB_SERVER_NAME     CN/SAN for the generated cert (default the container host)
#   INSIGHT_HUB_INTERNAL_ALLOW  CIDRs allowed to reach /v1/internal/, comma or space separated
#   INSIGHT_HUB_MAX_BODY        client_max_body_size          (default 64m)
# ─────────────────────────────────────────────────────────────────────────────
set -eu

TLS_DIR=/etc/nginx/tls
CRT="$TLS_DIR/server.crt"
KEY="$TLS_DIR/server.key"

INSIGHT_HUB_TLS_MODE="${INSIGHT_HUB_TLS_MODE:-redirect}"
INSIGHT_HUB_SERVER_NAME="${INSIGHT_HUB_SERVER_NAME:-$(hostname)}"
INSIGHT_HUB_INTERNAL_ALLOW="${INSIGHT_HUB_INTERNAL_ALLOW:-127.0.0.1/32}"

export INSIGHT_HUB_UPSTREAM="${INSIGHT_HUB_UPSTREAM:-server:3000}"
export INSIGHT_HUB_MAX_BODY="${INSIGHT_HUB_MAX_BODY:-64m}"

log() { echo "insight-hub-nginx: $*"; }
fail() { echo "insight-hub-nginx: $*" >&2; exit 1; }

case "$INSIGHT_HUB_TLS_MODE" in
    redirect|off) ;;
    *) fail "INSIGHT_HUB_TLS_MODE must be 'redirect' or 'off'" ;;
esac

case "$INSIGHT_HUB_SERVER_NAME" in
    ''|*[!A-Za-z0-9._-]*) fail "INSIGHT_HUB_SERVER_NAME contains invalid characters" ;;
esac

case "$INSIGHT_HUB_UPSTREAM" in
    *[!A-Za-z0-9._:-]*|'') fail "INSIGHT_HUB_UPSTREAM must be a host:port value" ;;
esac

case "$INSIGHT_HUB_MAX_BODY" in
    *[!0-9kKmMgG]*|'') fail "INSIGHT_HUB_MAX_BODY must be a size such as 64m" ;;
esac

# ── 1. Allowlist for /v1/internal/ ───────────────────────────────────────────
# Ends in `deny all`, so an empty or malformed list closes the endpoint rather
# than opening it. A collector that suddenly 403s is a visible, recoverable
# failure; an internal API exposed to the world is not.
acl=/etc/nginx/insight-hub-internal-acl.conf
: > "$acl"
for cidr in $(printf '%s' "$INSIGHT_HUB_INTERNAL_ALLOW" | tr ',;' '  '); do
    case "$cidr" in
        *[!0-9A-Fa-f.:/]*) fail "invalid address in INSIGHT_HUB_INTERNAL_ALLOW: $cidr" ;;
    esac
    printf 'allow %s;\n' "$cidr" >> "$acl"
done
printf 'deny all;\n' >> "$acl"
log "internal API allowlist: $INSIGHT_HUB_INTERNAL_ALLOW"

# ── 2. TLS material ──────────────────────────────────────────────────────────
if [ "$INSIGHT_HUB_TLS_MODE" = "off" ]; then
    log "TLS disabled (INSIGHT_HUB_TLS_MODE=off) — serving plain HTTP on :80"
    template=plain
else
    mkdir -p "$TLS_DIR"
    # Only generated when absent, and the directory is a volume, so a real
    # certificate mounted or copied in is never overwritten on restart.
    if [ ! -s "$CRT" ] || [ ! -s "$KEY" ]; then
        log "no certificate in $TLS_DIR — generating a self-signed one for $INSIGHT_HUB_SERVER_NAME"
        log "browsers will warn until you replace it with one your CA issued"
        openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
            -subj "/CN=$INSIGHT_HUB_SERVER_NAME" \
            -addext "subjectAltName=DNS:$INSIGHT_HUB_SERVER_NAME,DNS:localhost,IP:127.0.0.1" \
            -keyout "$KEY" -out "$CRT" 2>/dev/null
    else
        log "using the certificate already present in $TLS_DIR"
    fi
    chmod 600 "$KEY"
    chmod 644 "$CRT"
    template=tls
fi

# ── 3. Render ────────────────────────────────────────────────────────────────
# Named variables only: an unrestricted envsubst would eat every nginx $variable
# in the template and emit a config full of empty strings.
envsubst '${INSIGHT_HUB_MAX_BODY}' \
    < /etc/nginx/ei/templates/locations.conf.template \
    > /etc/nginx/insight-hub-locations.conf
envsubst '${INSIGHT_HUB_UPSTREAM}' \
    < "/etc/nginx/ei/templates/$template.conf.template" \
    > /etc/nginx/conf.d/insight-hub.conf

log "proxying to $INSIGHT_HUB_UPSTREAM (mode: $INSIGHT_HUB_TLS_MODE)"

nginx -t

exec /docker-entrypoint.sh nginx -g 'daemon off;'
