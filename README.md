# OpenSandbox Management Panel

A production-grade management UI for [alibaba/OpenSandbox](https://github.com/alibaba/OpenSandbox).
It talks to the upstream OpenSandbox lifecycle server, drives the full sandbox
lifecycle, and integrates a complete developer experience — embedded VS Code,
a real terminal, file manager, git import, logs, metrics, and live port
scanning — all from one Go binary plus a shadcn/ui frontend.

## Feature highlights

- **Full sandbox lifecycle**: create (with templates), list, filter, search,
  detail, pause, resume, renew expiration, delete. Snapshots are surfaced when
  the runtime supports them.
- **Integrated VS Code Web**: one click starts code-server in the sandbox and
  embeds the workbench in an iframe. WebSockets (workbench, terminal, ext host)
  are proxied with `Origin` rewriting so code-server's same-origin check
  passes.
- **Interactive terminal**: in-browser xterm.js terminal attached to a
  per-tab execd shell session, all over a single WebSocket that the panel
  multiplexes on top of `/session/{id}/run` SSE streams.
- **File manager**: browse any path in the sandbox, upload / download,
  create / delete / mkdir, and edit small files in place. Mode strings and
  mtime come straight from `find -printf`.
- **Git import**: clone any Git URL into the sandbox. If `git` isn't
  installed, the panel falls back to downloading a codeload tarball, so
  this works on minimal images too.
- **Live ports scanner**: parses `/proc/net/tcp` every few seconds and lists
  listening TCP ports, each with a one-click open-in-new-tab proxy link.
- **Diagnostics**: logs and events viewers with live tail + in-browser
  filtering.
- **Metrics**: CPU + memory panel with sparklines.
- **Templates**: built-in starter configurations plus user templates
  persisted in `localStorage`. Launch with one click from the Templates page
  or save the current sandbox as a template from its detail page.
- **One-click services**: a Services tab inside each sandbox starts /
  stops common dev services with the right command (JupyterLab,
  static HTTP, code-server, Streamlit demo, PostgreSQL, Redis) and shows a
  green "running" badge once the port is detected.
- **Pools**: list, create, and delete Kubernetes warm pools (the panel
  shows a friendly "Kubernetes-only feature" state when the upstream
  runtime doesn't support pools).
- **Multi-tab terminal**: spawn several independent bash sessions in the
  same sandbox, switch / close tabs, each backed by its own WebSocket.
- **Image preview** in the file browser for png/jpg/gif/webp/svg/etc.;
  large or known-binary files are offered as direct downloads.
- **Restore from snapshot**, network-policy editor, and volume mounts are
  exposed in the create dialog under an Advanced tab.
- **Runtime connection config**: change the upstream URL and API key without
  restarting the backend. Values are persisted in `localStorage`, forwarded
  to the Go server as cookies, and visualised with a live health banner.
- **First-run setup wizard** with copy-paste commands that bootstrap an
  OpenSandbox server on the host.
- **Command palette (⌘K)** for fast navigation between pages and sandboxes.
- **Dark / light / system** theme toggle.
- **Optional panel secret** (`-panel-secret` / `OSBUI_PANEL_SECRET`) that
  gates all routes.

## Screenshots

See `/tmp/shot-*.png` after running `node screenshot2.mjs` locally, or walk
through the UI yourself once the backend is running.

## Architecture

```
                  /api/*                ┌──────────────────┐
Browser ───► Panel ───► (API key) ─────►│ OpenSandbox       │
            (Go)        injected        │ lifecycle server  │
                                        └──────────────────┘
             /sandbox-proxy/<id>/port/<port>/…       │
             (HTTP + WebSocket, Origin rewrite)      ▼
                                        ┌──────────────────┐
             /panel/sandboxes/<id>/*    │ sandbox container│
             (exec / files / git /      │  + execd sidecar │
              logs / metrics / ports /  └──────────────────┘
              vscode start, …)
             /panel/terminal/<id>  (WebSocket → execd session)
```

The Go binary serves four groups of routes on the same port:

| Route                                               | Purpose                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `/api/*`                                            | Reverse proxy to the OpenSandbox server, injects API key       |
| `/panel/sandboxes/<id>/vscode/start`                | Idempotent code-server launcher                                |
| `/panel/sandboxes/<id>/exec`                        | One-shot shell command                                         |
| `/panel/sandboxes/<id>/git-clone`                   | git clone with tarball fallback                                |
| `/panel/sandboxes/<id>/files`, `/files/{read,write,upload,download,mkdir}` | Filesystem ops via execd multipart |
| `/panel/sandboxes/<id>/ports`                       | Listening TCP ports inside the sandbox                         |
| `/panel/sandboxes/<id>/logs`, `/events`             | Diagnostics pass-through                                       |
| `/panel/sandboxes/<id>/metrics`, `/metrics/watch`   | execd metrics, live SSE stream                                 |
| `/panel/terminal/<id>`                              | WebSocket terminal bridging a bash session                     |
| `/panel/upstream/health`, `/panel/config`           | Health + runtime config                                        |
| `/sandbox-proxy/<id>/port/<port>/…`                 | Reverse proxy (HTTP/WS) to any port in the sandbox             |
| `/`                                                 | Compiled React SPA                                             |

## Quick start

### 1. Run the OpenSandbox server

```bash
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker
# (optional) set server.api_key = "..." in the TOML
opensandbox-server
```

### 2. Build and run the panel

```bash
make build
OSBUI_UPSTREAM=http://127.0.0.1:8080 \
OSBUI_API_KEY=local-dev-key \
./osbui-panel -listen 0.0.0.0:5173 -static ./frontend/dist
```

Open <http://127.0.0.1:5173>. The first-run wizard lets you set the upstream
URL and API key interactively if you didn't provide them on the command line.

### 3. Launch your first sandbox

- Click **Templates** → **VS Code Web** → **Launch** (or click **New
  sandbox** from the Sandboxes list).
- Once the sandbox reaches **Running**, open the detail page and play with
  the **Files**, **Terminal**, **Ports**, **Logs**, and **Metrics** tabs,
  then hit **Open VS Code** for a full browser-based IDE backed by the
  sandbox filesystem.

## Configuration

| Flag            | Env var              | Default                 |
| --------------- | -------------------- | ----------------------- |
| `-listen`       | —                    | `0.0.0.0:5173`          |
| `-upstream`     | `OSBUI_UPSTREAM`     | `http://127.0.0.1:8080` |
| `-api-key`      | `OSBUI_API_KEY`      | empty                   |
| `-static`       | `OSBUI_STATIC`       | `./frontend/dist`       |
| `-panel-secret` | `OSBUI_PANEL_SECRET` | empty                   |

Every connection value is overridable at runtime from the Settings page; the
browser stores them in `localStorage` and sends them to the Go backend through
cookies (`osb_upstream`, `osb_apikey`).

## Development

```bash
# Terminal 1 — OpenSandbox server
opensandbox-server

# Terminal 2 — Go backend (rebuilds on save)
make dev-backend

# Terminal 3 — Vite dev server (proxies /api, /panel, /sandbox-proxy)
make dev-frontend
```

Visit <http://127.0.0.1:5174>.

## Verified end-to-end

Three Playwright suites pass against a real OpenSandbox server (Docker
runtime), 28 checks in total:

- **`e2e.mjs`** — create, run, pause, resume, renew, snapshot-unsupported
  handling, VS Code iframe + workbench HTML + WebSocket handshake + file
  write/read through exec, delete.
- **`e2e2.mjs`** — panel loads, dark mode toggle, command palette,
  template-based launch, file browser create+edit+upload, git import,
  ports scanner, metrics panel, logs, terminal WebSocket round-trip,
  settings page, list-based delete.
- **`e2e3.mjs`** — pools page Kubernetes-only state, advanced create
  dialog (network-policy editor, volumes editor, request body shape),
  service launcher actually starts the static HTTP service and the panel
  detects port 8000 listening, multi-tab terminal spawns extra sessions,
  image preview renders an `<img>` for an uploaded PNG, snapshots page
  reachable, cleanup.

## License

Apache-2.0, inheriting from OpenSandbox.
