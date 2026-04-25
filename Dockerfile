# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the frontend (Vite -> static assets) ----
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build the Go backend (static binary) ----
FROM golang:1.24-alpine AS backend-builder
ARG VERSION=docker
WORKDIR /src

COPY backend/go.mod ./backend/
RUN cd backend && go mod download

COPY backend/ ./backend/
RUN cd backend && \
    CGO_ENABLED=0 GOOS=linux go build \
        -trimpath \
        -ldflags "-s -w -X github.com/lyianu/osbui/backend/internal/server.Version=${VERSION}" \
        -o /out/osbui-panel .

# ---- Stage 3: runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S osbui && adduser -S -G osbui osbui

WORKDIR /app
COPY --from=backend-builder  /out/osbui-panel        /usr/local/bin/osbui-panel
COPY --from=frontend-builder /app/frontend/dist      /app/frontend/dist

USER osbui

ENV OSBUI_STATIC=/app/frontend/dist \
    OSBUI_UPSTREAM=http://127.0.0.1:8080

EXPOSE 5173

ENTRYPOINT ["/usr/local/bin/osbui-panel"]
CMD ["-listen", "0.0.0.0:5173"]
