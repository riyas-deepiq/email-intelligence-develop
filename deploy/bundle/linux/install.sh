#!/bin/sh
# ============================================================================
# Insight Hub — self-contained container installer (runs inside the .run bundle).
#
# One script, three roles. The bundle declares which one it carries in its ROLE
# file, so this never has to guess:
#
#   server     PostgreSQL + Redis + the API and web interface   (publishes 8080)
#   collector  the ingestion worker only                        (no inbound port)
#   rag        Qdrant + Redis + Ollama + the RAG API             (publishes 8000)
#
# Roles can run on one machine or separate nodes when their required endpoints
# are reachable. When the collector lands on a machine that already has the
# server, it reads COLLECTOR_SECRET from the server configuration. RAG also
# requires a reachable PostgreSQL endpoint and may need model-registry access on
# first start unless its Ollama volume is pre-seeded.
#
#   --bundle-dir DIR        extracted payload (supplied by the header)
#   --version X.Y.Z         release being installed
#   --role NAME             override the bundle's ROLE file
#   --port N                server only: host port for the web UI (default 8080)
#   --server-url URL        collector or rag: reachable Core Server URL
#   --collector-secret S    collector only: must match the server's
#   --postgres-url URL      rag only: reachable Core Server PostgreSQL URL
#   --rag-secret S          rag only: must match server config RAG_INTERNAL_SECRET
#   --rag-port N            rag only: host port for the RAG API (default 8000)
#   --rag-bind ADDRESS      rag only: bind address (default 0.0.0.0)
#   --data-dir DIR          persistent state (default /var/lib/insight-hub)
#   --no-start              install but do not start
# ============================================================================
set -eu

BUNDLE_DIR=""
VERSION="unknown"
ROLE=""
HTTP_PORT="8080"
SERVER_URL=""
COLLECTOR_SECRET=""
POSTGRES_URL=""
RAG_SECRET=""
RAG_PORT="8000"
RAG_BIND="0.0.0.0"
RAG_PORT_SET=0
RAG_BIND_SET=0
INSTALL_ROOT="/opt/insight-hub"
CONFIG_ROOT="/etc/insight-hub"
DATA_ROOT="/var/lib/insight-hub"
LOG_ROOT="/var/log/insight-hub"
START=1

while [ $# -gt 0 ]; do
    case "$1" in
        --bundle-dir)       BUNDLE_DIR="${2:?}"; shift 2 ;;
        --version)          VERSION="${2:?}"; shift 2 ;;
        --role)             ROLE="${2:?}"; shift 2 ;;
        --port)             HTTP_PORT="${2:?}"; shift 2 ;;
        --server-url)       SERVER_URL="${2:?}"; shift 2 ;;
        --collector-secret) COLLECTOR_SECRET="${2:?}"; shift 2 ;;
        --postgres-url)      POSTGRES_URL="${2:?}"; shift 2 ;;
        --rag-secret)        RAG_SECRET="${2:?}"; shift 2 ;;
        --rag-port)          RAG_PORT="${2:?}"; RAG_PORT_SET=1; shift 2 ;;
        --rag-bind)          RAG_BIND="${2:?}"; RAG_BIND_SET=1; shift 2 ;;
        --data-dir)         DATA_ROOT="${2:?}"; shift 2 ;;
        --no-start)         START=0; shift ;;
        "") shift ;;
        *) echo "error: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

log()  { echo "==> $*"; }
fail() { echo "error: $*" >&2; exit 1; }
env_value() { grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- || true; }

[ -n "$BUNDLE_DIR" ] || fail "--bundle-dir is required"
[ -n "$ROLE" ] || ROLE="$(cat "$BUNDLE_DIR/ROLE" 2>/dev/null || echo '')"
[ -n "$ROLE" ] || fail "the bundle does not declare a role and --role was not given"

case "$ROLE" in
    server|collector|rag) ;;
    *) fail "unknown role '$ROLE'" ;;
esac

INSTALL_DIR="$INSTALL_ROOT/$ROLE"
CONFIG_DIR="$CONFIG_ROOT/$ROLE"
ENV_FILE="$CONFIG_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
SERVICE="insight-hub-$ROLE"
# Distinct compose project per role. Without this, installing several roles on
# one machine would give their stacks the same project name and a later `up` could
# adopt and then tear down the first one's containers.
PROJECT="insight-hub-$ROLE"
START_TIMEOUT=600
[ "$ROLE" = "rag" ] && START_TIMEOUT=3600

# ── 1. Preflight ────────────────────────────────────────────────────────────
log "Installing the $ROLE role (version $VERSION)"
log "Checking prerequisites"

if command -v docker >/dev/null 2>&1; then
    RUNTIME="docker"
elif command -v podman >/dev/null 2>&1; then
    RUNTIME="podman"
else
    fail "no container runtime found.
  Install Docker Engine first:
    Debian/Ubuntu:  curl -fsSL https://get.docker.com | sh
    RHEL/Rocky:     sudo dnf install -y docker-ce docker-compose-plugin
  Then re-run this installer."
fi

$RUNTIME compose version >/dev/null 2>&1 \
    || fail "the compose plugin is missing. Install docker-compose-plugin and re-run."
$RUNTIME info >/dev/null 2>&1 \
    || fail "the container runtime is installed but not running. Try: systemctl start docker"

if { [ "$ROLE" = "server" ] || [ "$ROLE" = "rag" ]; } && [ ! -f "$ENV_FILE" ]; then
    CHECK_PORT="$HTTP_PORT"
    [ "$ROLE" = "rag" ] && CHECK_PORT="$RAG_PORT"
    case "$CHECK_PORT" in *[!0-9]*|'') fail "port must be an integer" ;; esac
    [ "$CHECK_PORT" -ge 1 ] && [ "$CHECK_PORT" -le 65535 ] || fail "port must be between 1 and 65535"
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$CHECK_PORT "; then
        fail "port $CHECK_PORT is already in use."
    fi
fi

if [ "$ROLE" = "rag" ]; then
    if [ -f "$ENV_FILE" ]; then
        [ -n "$POSTGRES_URL" ] || POSTGRES_URL="$(env_value "$ENV_FILE" RAG_POSTGRES_URL)"
        [ -n "$SERVER_URL" ] || SERVER_URL="$(env_value "$ENV_FILE" CORE_SERVER_URL)"
        [ -n "$RAG_SECRET" ] || RAG_SECRET="$(env_value "$ENV_FILE" RAG_INTERNAL_SECRET)"
        [ "$RAG_PORT_SET" -eq 1 ] || RAG_PORT="$(env_value "$ENV_FILE" RAG_PORT)"
        [ "$RAG_BIND_SET" -eq 1 ] || RAG_BIND="$(env_value "$ENV_FILE" RAG_BIND)"
        RAG_PORT="${RAG_PORT:-8000}"
        RAG_BIND="${RAG_BIND:-0.0.0.0}"
    fi
    SERVER_ENV="$CONFIG_ROOT/server/.env"
    if [ -z "$RAG_SECRET" ] && [ -f "$SERVER_ENV" ]; then
        RAG_SECRET="$(grep '^RAG_INTERNAL_SECRET=' "$SERVER_ENV" | cut -d= -f2- || true)"
    fi
    if [ -z "$SERVER_URL" ] && [ -f "$SERVER_ENV" ]; then
        SERVER_PORT="$(grep '^SERVER_PORT=' "$SERVER_ENV" | cut -d= -f2- || echo 8080)"
        SERVER_URL="http://host.docker.internal:${SERVER_PORT:-8080}"
    fi

    case "$SERVER_URL" in http://*|https://*) ;; *) fail "--server-url must start with http:// or https://" ;; esac
    case "$POSTGRES_URL" in postgresql://*|postgresql+psycopg2://*) ;;
        *) fail "--postgres-url must be a PostgreSQL SQLAlchemy URL" ;;
    esac
    [ "${#RAG_SECRET}" -ge 16 ] || fail "--rag-secret must be at least 16 characters and match the Core Server's RAG_INTERNAL_SECRET configuration"
    case "$RAG_BIND" in *[!0-9A-Fa-f:.]*|'') fail "--rag-bind must be an IP address" ;; esac
fi

# ── 2. Collector: find the server it belongs to ─────────────────────────────
if [ "$ROLE" = "collector" ]; then
    SERVER_ENV="$CONFIG_ROOT/server/.env"
    if [ -z "$COLLECTOR_SECRET" ] && [ -f "$SERVER_ENV" ]; then
        log "Reading COLLECTOR_SECRET from the server installed on this machine"
        COLLECTOR_SECRET="$(grep '^COLLECTOR_SECRET=' "$SERVER_ENV" | cut -d= -f2- || true)"
        if [ -z "$SERVER_URL" ]; then
            SERVER_PORT="$(grep '^SERVER_PORT=' "$SERVER_ENV" | cut -d= -f2- || echo 8080)"
            SERVER_URL="http://172.17.0.1:${SERVER_PORT:-8080}"
        fi
    fi

    [ -n "$SERVER_URL" ] || fail "--server-url is required (e.g. http://insight-hub-server.corp:8080)"
    [ -n "$COLLECTOR_SECRET" ] || fail "--collector-secret is required.
  Take it from COLLECTOR_SECRET in $CONFIG_ROOT/server/.env on the server machine.
  If the two do not match, every poll is rejected with 401 and no mail is
  collected — visible only as lastPollError on the collector's /health."
fi

# ── 3. Directories ──────────────────────────────────────────────────────────
log "Creating directories"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_ROOT" "$DATA_ROOT"
if [ "$ROLE" = "server" ]; then
    mkdir -p "$DATA_ROOT/postgres" "$DATA_ROOT/redis"
fi
chmod 0750 "$CONFIG_ROOT" "$CONFIG_DIR" "$DATA_ROOT" "$LOG_ROOT"

# ── 4. Images ───────────────────────────────────────────────────────────────
log "Loading container images"
for archive in "$BUNDLE_DIR"/images/*.tar.gz; do
    [ -f "$archive" ] || continue
    echo "    $(basename "$archive")"
    gzip -dc "$archive" | $RUNTIME load >/dev/null
done

# ── 5. Configuration ────────────────────────────────────────────────────────
cp "$BUNDLE_DIR/compose/docker-compose.yml" "$COMPOSE_FILE"
cp "$BUNDLE_DIR/MANIFEST" "$INSTALL_DIR/MANIFEST"
cp "$BUNDLE_DIR/config/.env.template" "$CONFIG_DIR/.env.default"

gen_secret() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}"
    else head -c "$((${1:-32} * 2))" /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c "1-$((${1:-32} * 2))"
    fi
}

set_var() {
    key="$1"; value="$2"
    [ "$(printf '%s' "$value" | wc -l)" -eq 0 ] || fail "$key contains a newline"
    carriage_return="$(printf '\r')"
    case "$value" in *"$carriage_return"*) fail "$key contains a carriage return" ;; esac
    tmp="${ENV_FILE}.tmp.$$"
    awk -v key="$key" -v value="$value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$ENV_FILE" > "$tmp"
    chmod 0600 "$tmp"
    mv "$tmp" "$ENV_FILE"
}

if [ -f "$ENV_FILE" ]; then
    log "Keeping the existing $ENV_FILE (upgrade)"
    set_var IMAGE_TAG "$VERSION"
else
    log "Generating configuration and per-machine secrets"
    cp "$BUNDLE_DIR/config/.env.template" "$ENV_FILE"
    set_var IMAGE_TAG "$VERSION"

    if [ "$ROLE" = "server" ]; then
        set_var POSTGRES_PASSWORD   "$(gen_secret 24)"
        set_var JWT_SECRET          "$(gen_secret 48)"
        set_var OIDC_ENCRYPTION_KEY "$(gen_secret 32)"
        set_var COLLECTOR_SECRET    "$(gen_secret 24)"
        set_var RAG_INTERNAL_SECRET "$(gen_secret 32)"
        set_var SEED_ADMIN_PASSWORD "$(gen_secret 12)"
        set_var SERVER_PORT         "$HTTP_PORT"
        set_var SERVER_BIND         "0.0.0.0"
    elif [ "$ROLE" = "collector" ]; then
        set_var COLLECTOR_SECRET "$COLLECTOR_SECRET"
        set_var SERVER_URL       "$SERVER_URL"
    else
        set_var RAG_POSTGRES_URL    "$POSTGRES_URL"
        set_var CORE_SERVER_URL     "$SERVER_URL"
        set_var RAG_INTERNAL_SECRET "$RAG_SECRET"
        set_var RAG_PORT            "$RAG_PORT"
        set_var RAG_BIND            "$RAG_BIND"
    fi

    chmod 0600 "$ENV_FILE"
fi

# ── 6. Service registration ─────────────────────────────────────────────────
if [ -d /run/systemd/system ]; then
    log "Registering $SERVICE"
    cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Insight Hub ($ROLE)
Documentation=file://$INSTALL_DIR/MANIFEST
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
# --wait makes "started" mean "all health checks passing", so a failed
# systemctl start is a true signal rather than a container that came up broken.
ExecStart=/usr/bin/env $RUNTIME compose -p $PROJECT --env-file $ENV_FILE -f $COMPOSE_FILE up -d --wait --wait-timeout $START_TIMEOUT
ExecStop=/usr/bin/env $RUNTIME compose -p $PROJECT --env-file $ENV_FILE -f $COMPOSE_FILE down
TimeoutStartSec=$START_TIMEOUT

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "$SERVICE" >/dev/null 2>&1 || true
else
    log "systemd not detected — skipping service registration"
fi

# ── 7. Start ────────────────────────────────────────────────────────────────
if [ "$START" -eq 0 ]; then
    log "Installed. Start it with: systemctl start $SERVICE"
    exit 0
fi

log "Starting services"
if [ -d /run/systemd/system ]; then
    systemctl restart "$SERVICE"
else
    (cd "$INSTALL_DIR" && $RUNTIME compose -p "$PROJECT" --env-file "$ENV_FILE" up -d --wait --wait-timeout "$START_TIMEOUT")
fi

# ── 8. Verify ───────────────────────────────────────────────────────────────
if [ "$ROLE" = "server" ]; then
    log "Waiting for the service to answer"
    i=0
    until curl -fsS "http://127.0.0.1:$HTTP_PORT/api/v1/health" >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge 60 ]; then
            echo "warning: the service did not become healthy within 5 minutes." >&2
            echo "  Check: $RUNTIME compose -p $PROJECT -f $COMPOSE_FILE logs server" >&2
            exit 1
        fi
        sleep 5
    done

    ADMIN_EMAIL=$(grep '^SEED_ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)
    COLLECTOR_KEY=$(grep '^COLLECTOR_SECRET=' "$ENV_FILE" | cut -d= -f2-)
    cat <<EOF

  Insight Hub $VERSION (server) is installed and running.

    URL       http://$(hostname -I 2>/dev/null | awk '{print $1}'):$HTTP_PORT
    Sign in   ${ADMIN_EMAIL:-admin@insight-hub.local}
    Password  see SEED_ADMIN_PASSWORD in $ENV_FILE

  Change that password on first login, then set SEED_DEFAULT_ADMIN=false.

  To add a collector on another machine:
    sudo ./insight-hub-collector-$VERSION.run -- \\
         --server-url http://$(hostname -I 2>/dev/null | awk '{print $1}'):$HTTP_PORT \\
         --collector-secret $COLLECTOR_KEY

  To add RAG, use RAG_INTERNAL_SECRET from $ENV_FILE and then set RAG_API_URL
  in this file to the RAG node URL.

EOF
elif [ "$ROLE" = "collector" ]; then
    log "Checking the collector"
    sleep 5
    if $RUNTIME compose -p "$PROJECT" -f "$COMPOSE_FILE" ps --status running 2>/dev/null | grep -q collector; then
        cat <<EOF

  Insight Hub $VERSION (collector) is installed and running.

    Polling   $SERVER_URL
    Logs      $RUNTIME compose -p $PROJECT -f $COMPOSE_FILE logs -f collector

  A wrong COLLECTOR_SECRET shows up as lastPollOk:false with a 401 in
  lastPollError — the collector stays up either way, so check the log.

EOF
    else
        echo "warning: the collector container is not running — check the logs." >&2
        exit 1
    fi
else
    log "Checking the RAG service"
    if $RUNTIME compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
        exec -T rag curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
        cat <<EOF

  Insight Hub $VERSION (RAG) is installed and healthy.

    RAG URL   http://$(hostname -I 2>/dev/null | awk '{print $1}'):$RAG_PORT
    Config    $ENV_FILE
    Logs      $RUNTIME compose -p $PROJECT -f $COMPOSE_FILE logs -f rag

  Set RAG_API_URL on the Core Server. Its existing RAG_INTERNAL_SECRET must
  match this RAG role; Compose passes that value to the server as RAG_API_SECRET.

EOF
    else
        echo "warning: the RAG service is not healthy — check the RAG and ollama-init logs." >&2
        exit 1
    fi
fi
