# OpenSandbox Management Panel

A complete, production-grade management UI for [alibaba/OpenSandbox](https://github.com/alibaba/OpenSandbox).
It talks to the upstream OpenSandbox lifecycle server, exposes full CRUD and
lifecycle operations for sandboxes, and embeds VS Code Web (code-server) in the
browser for any sandbox built on the `opensandbox/vscode` image.

## Highlights

- **Full sandbox lifecycle** — create, list, inspect, pause, resume, renew
  expiration, and delete. Snapshots are surfaced when the upstream server
  supports them.
- **Embedded VS Code Web** — one click launches code-server inside a sandbox
  and renders it in an iframe. WebSockets (workbench, terminal, extension
  host) all go through the panel's reverse proxy.
- **Clean shadcn/ui frontend** — React + TypeScript + Vite + Tailwind.
  Components are the canonical shadcn/ui primitives, vendored into
  `frontend/src/components/ui/`.
- **Single binary backend** — a small Go service proxies `/api/*` to the
  OpenSandbox server (injecting the API key), reverse-proxies per-sandbox
  port traffic at `/sandbox-proxy/<id>/port/<port>/...`, and serves the
  compiled frontend. WebSocket upgrades and `Origin` rewriting are handled so
  cross-origin checks inside code-server pass.
- **Pluggable auth** — an optional `-panel-secret` shared secret gates the
  entire panel via the `X-Panel-Secret` header or `panel_secret` cookie.

## Architecture

```
              ┌──────────┐      /api/*            ┌──────────────────┐
 Browser ───► │  Panel   │ ───► (with API key) ──►│ OpenSandbox      │
              │ (Go)     │                         │ lifecycle server │
              │          │      /sandbox-proxy/id/port/*              │
              │          │ ───────────────────────►ingress:<port>     │
              │          │                         │  sidecar (44772) │
              │  React + │ ◄─── WebSocket bidi ───►│                  │
              │ shadcn/ui│                         │  sandbox port    │
              └──────────┘                         └──────────────────┘
```

The Go binary serves three things on the same port:

| Route                                     | What it does                                                  |
| ----------------------------------------- | ------------------------------------------------------------- |
| `/api/*`                                  | Reverse proxy to the OpenSandbox server, injects API key.     |
| `/panel/sandboxes/<id>/vscode/start`      | Starts `code-server` inside the sandbox via the execd.        |
| `/panel/sandboxes/<id>/exec`              | Run ad-hoc shell commands inside the sandbox.                 |
| `/panel/sandboxes/<id>/endpoint?port=N`   | Resolve direct + proxy URLs for a sandbox port.               |
| `/sandbox-proxy/<id>/port/<port>/...`     | Reverse proxy for HTTP and WebSocket to a sandbox port.       |
| `/panel/config`, `/healthz`               | Panel info and health.                                        |
| `/`                                       | Static files of the compiled frontend (SPA fallback).         |

## Quick start

### 1. Run the upstream OpenSandbox server

```bash
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker
# (optional) edit ~/.sandbox.toml to set server.api_key = "local-dev-key"
opensandbox-server
```

Server should be reachable at <http://127.0.0.1:8080>.

### 2. Build and run the panel

```bash
make build
OSBUI_UPSTREAM=http://127.0.0.1:8080 \
OSBUI_API_KEY=local-dev-key \
./osbui-panel -listen 0.0.0.0:5173 -static ./frontend/dist
```

Open <http://127.0.0.1:5173> in your browser.

### 3. Launch VS Code in a sandbox

1. Click **New sandbox** and pick the **VS Code Web** preset.
2. Once it reaches *Running*, click the **VS Code** button in the row.
3. The panel calls the execd to launch code-server on port 8443 inside the
   sandbox, then polls the reverse-proxy endpoint until code-server answers,
   and finally renders the workbench in an iframe.

## Configuration

All configuration is via flags or environment variables.

| Flag              | Env var              | Default                 | Description                                       |
| ----------------- | -------------------- | ----------------------- | ------------------------------------------------- |
| `-listen`         | —                    | `0.0.0.0:5173`          | Address the panel listens on.                     |
| `-upstream`       | `OSBUI_UPSTREAM`     | `http://127.0.0.1:8080` | OpenSandbox lifecycle server URL.                 |
| `-api-key`        | `OSBUI_API_KEY`      | empty                   | Injected into `OPEN-SANDBOX-API-KEY` header.      |
| `-static`         | `OSBUI_STATIC`       | `./frontend/dist`       | Directory with the compiled frontend.             |
| `-panel-secret`   | `OSBUI_PANEL_SECRET` | empty                   | Optional shared secret gating panel access.       |

When `OSBUI_PANEL_SECRET` is set, every request to `/api/*`,
`/panel/sandboxes/*`, and `/sandbox-proxy/*` must include the same value via
the `X-Panel-Secret` header or the `panel_secret` cookie.

## Development

```bash
# Terminal 1 — OpenSandbox server on :8080
opensandbox-server

# Terminal 2 — Go backend on :5173 (rebuilds on demand)
make dev-backend

# Terminal 3 — Vite dev server on :5174 (proxies to :5173)
make dev-frontend
```

Visit <http://127.0.0.1:5174> during development — Vite takes care of HMR.

## Project layout

```
backend/
  main.go
  internal/
    config/      config struct passed around the server
    proxy/       upstream + per-sandbox reverse proxy, execd bridge
    server/      HTTP routes, SPA fallback, auth middleware
frontend/
  src/
    components/ui/   shadcn/ui primitives (button, card, dialog, toast, …)
    components/      CreateSandboxDialog, ConfirmDeleteDialog
    pages/           SandboxesPage, SandboxDetailPage, SandboxVSCodePage,
                    SnapshotsPage, SettingsPage
    hooks/use-toast.ts
    lib/api.ts       strongly-typed OpenSandbox client + panel endpoints
    lib/utils.ts     cn(), shortId(), formatDate/Relative
Makefile             build / run / dev recipes
```

## How the VS Code launcher works

The OpenSandbox server exposes a per-sandbox *ingress proxy* port (typically
`44772` inside the container) that forwards `/proxy/<port>/...` to any port
inside the sandbox.  The panel's `/sandbox-proxy/<id>/port/<port>/...` is a
thin reverse proxy in front of that ingress with two important fix-ups:

1. **Origin rewriting** — code-server rejects WebSocket upgrades whose
   `Origin` header doesn't match the `Host`.  The panel sets the outgoing
   `Origin` to the ingress origin, so the workbench WebSocket and terminal
   PTY connections succeed.
2. **Absolute `Location` rewriting** — if the upstream returns an absolute
   redirect pointing into `/proxy/<port>/...`, the panel rewrites it to
   `/sandbox-proxy/<id>/port/<port>/...` so the browser stays on the panel
   origin.

`POST /panel/sandboxes/<id>/vscode/start` is an idempotent helper: it checks
`pgrep code-server` inside the sandbox and, if not running, spawns
`code-server --bind-addr 0.0.0.0:8443 --auth none /workspace` in the
background via the execd's `/command` endpoint.

## License

Apache-2.0, inheriting from OpenSandbox.
