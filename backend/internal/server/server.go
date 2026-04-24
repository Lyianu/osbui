package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lyianu/osbui/backend/internal/config"
	"github.com/lyianu/osbui/backend/internal/proxy"
)

// Version is set at build time via -ldflags; defaults to "dev".
var Version = "dev"

// Routes builds the top-level HTTP mux for the management panel.
func Routes(cfg config.Config, px *proxy.Proxy) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("/panel/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"upstream":       cfg.Upstream,
			"panelAuth":      cfg.PanelSecret != "",
			"apiKeyInjected": cfg.APIKey != "",
			"version":        Version,
		})
	})

	authed := func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cfg.PanelSecret != "" {
				tok := r.Header.Get("X-Panel-Secret")
				if tok == "" {
					if c, err := r.Cookie("panel_secret"); err == nil {
						tok = c.Value
					}
				}
				if tok != cfg.PanelSecret {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
			}
			h.ServeHTTP(w, r)
		})
	}

	mux.Handle("/api/", authed(http.HandlerFunc(px.APIProxy)))
	mux.Handle("/panel/sandboxes/", authed(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panelSandboxHandler(cfg, px, w, r)
	})))
	mux.Handle("/sandbox-proxy/", authed(http.HandlerFunc(px.SandboxPortProxy)))

	mux.Handle("/", spaHandler(cfg.StaticDir))

	return withRequestLog(mux)
}

func panelSandboxHandler(cfg config.Config, px *proxy.Proxy, w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	id := parts[2]
	action := strings.Join(parts[3:], "/")

	switch {
	case r.Method == http.MethodPost && action == "vscode/start":
		startVSCode(px, w, id)
	case r.Method == http.MethodPost && action == "exec":
		proxyExec(px, w, r, id)
	case r.Method == http.MethodGet && action == "endpoint":
		resolveEndpointHandler(px, w, r, id)
	case r.Method == http.MethodDelete && strings.HasPrefix(action, "cache"):
		px.InvalidateSandbox(id)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func startVSCode(px *proxy.Proxy, w http.ResponseWriter, id string) {
	// Probe first to make the call idempotent. execd's background=true spawns the
	// command as a new process; launching code-server twice is harmless because
	// the second invocation fails with "address already in use" and exits.
	check, err := px.RunInExecd(id, "pgrep -x code-server >/dev/null 2>&1 && echo running || echo stopped", false, 5000)
	if err == nil && len(check.Stdout) > 0 && strings.HasPrefix(check.Stdout[0], "running") {
		writeJSON(w, http.StatusOK, map[string]any{
			"port":    8443,
			"url":     fmt.Sprintf("/sandbox-proxy/%s/port/8443/?folder=/workspace", id),
			"message": "code-server already running",
		})
		return
	}
	cmd := "code-server --bind-addr 0.0.0.0:8443 --auth none /workspace"
	if _, err := px.RunInExecd(id, cmd, true, 10000); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "exec_failed", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"port":    8443,
		"url":     fmt.Sprintf("/sandbox-proxy/%s/port/8443/?folder=/workspace", id),
		"message": "code-server start requested; it may take a few seconds to become reachable",
	})
}

func proxyExec(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Command    string `json:"command"`
		Background bool   `json:"background"`
		TimeoutMs  int    `json:"timeoutMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Command == "" {
		http.Error(w, "command is required", http.StatusBadRequest)
		return
	}
	res, err := px.RunInExecd(id, body.Command, body.Background, body.TimeoutMs)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "exec_failed", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func resolveEndpointHandler(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	port := r.URL.Query().Get("port")
	if port == "" {
		http.Error(w, "port is required", http.StatusBadRequest)
		return
	}
	var payload struct {
		Endpoint string `json:"endpoint"`
	}
	resp, err := px.DoUpstream(http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s/endpoints/%s", id, port), nil, &payload)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "resolve_failed", "message": err.Error()})
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeJSON(w, resp.StatusCode, map[string]any{"error": "upstream_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"direct": payload.Endpoint,
		"proxy":  fmt.Sprintf("/sandbox-proxy/%s/port/%s/", id, port),
	})
}

func spaHandler(root string) http.Handler {
	fs := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(r.URL.Path)
		if clean == "/" || clean == "." {
			serveIndex(root, w, r)
			return
		}
		target := filepath.Join(root, clean)
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			serveIndex(root, w, r)
			return
		}
		if ext := filepath.Ext(target); ext != "" {
			if ct := mime.TypeByExtension(ext); ct != "" {
				w.Header().Set("Content-Type", ct)
			}
		}
		fs.ServeHTTP(w, r)
	})
}

func serveIndex(root string, w http.ResponseWriter, r *http.Request) {
	index := filepath.Join(root, "index.html")
	data, err := os.ReadFile(index)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"service": "osbui-panel",
			"hint":    "frontend assets not built; run 'npm run build' in the frontend directory",
		})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.Copy(w, bytes.NewReader(data))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type statusRecorder struct {
	http.ResponseWriter
	status   int
	wroteHdr bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHdr {
		s.status = code
		s.wroteHdr = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := s.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func withRequestLog(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: 200}
		h.ServeHTTP(rw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rw.status, time.Since(start))
	})
}
