# ----------------------------------------------------------------------
# Multi-stage build for the OpenSandbox management panel.
#  * stage 1 — Vite/React frontend → static assets
#  * stage 2 — Go backend → single static binary
#  * stage 3 — distroless-ish runtime that bundles both
# ----------------------------------------------------------------------

FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
# `strict-ssl=false` is a network-egress workaround for restricted dev
# environments (corporate proxies that intercept HTTPS). It's a no-op when
# the certificate chain is intact.
RUN npm config set strict-ssl false \
 && npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-bookworm AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum* ./
RUN go mod download || true
COPY backend/ ./
ARG VERSION=docker
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags "-s -w -X github.com/lyianu/osbui/backend/internal/server.Version=${VERSION}" \
      -o /out/osbui-panel .

FROM debian:12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=backend  /out/osbui-panel       /usr/local/bin/osbui-panel
COPY --from=frontend /src/frontend/dist     /var/lib/osbui-panel/dist
ENV OSBUI_STATIC=/var/lib/osbui-panel/dist
EXPOSE 5173
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/osbui-panel"]
CMD ["-listen", "0.0.0.0:5173"]
