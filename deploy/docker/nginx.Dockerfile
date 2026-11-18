# ─────────────────────────────────────────────────────────────────────────────
# Edge proxy: TLS termination, the /v1/internal/ IP allowlist, and the real
# client IP the app's rate limiters depend on.
#
#   docker build -f deploy/docker/nginx.Dockerfile -t insight-hub/nginx .
#
# Build context is the repository root, like the other images here.
# ─────────────────────────────────────────────────────────────────────────────

# Stable line pinned to a patch release for reproducible customer builds.
FROM nginx:1.30.4-alpine

# openssl for the first-boot self-signed certificate. envsubst (gettext) is
# already in the base image for its own template mechanism.
RUN apk add --no-cache openssl \
 && rm -f /etc/nginx/conf.d/default.conf

COPY deploy/nginx/templates/          /etc/nginx/ei/templates/
COPY deploy/nginx/proxy-headers.conf  /etc/nginx/insight-hub-proxy-headers.conf
COPY deploy/nginx/entrypoint.sh       /usr/local/bin/insight-hub-nginx-entrypoint

# Set here rather than relying on the mode the file had in git — a checkout on
# Windows does not preserve it.
RUN chmod +x /usr/local/bin/insight-hub-nginx-entrypoint

EXPOSE 80 443

# Hits the proxy's own /healthz, not the app: this reports whether nginx is
# serving, which is the thing this container is responsible for. The app has its
# own health check. wget is busybox's — the image ships no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/insight-hub-nginx-entrypoint"]
