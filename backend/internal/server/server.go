package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/panel/config", func(w http.ResponseWriter, r *http.Request) {
		upstream, apiKey := px.RuntimeConfig(r)
		writeJSON(w, http.StatusOK, map[string]any{
			"upstream":       upstream,
			"upstreamConfig": cfg.Upstream,
			"apiKeyMasked":   maskKey(apiKey),
			"apiKeyDefault":  cfg.APIKey != "",
			"panelAuth":      cfg.PanelSecret != "",
			"version":        Version,
		})
	})
	mux.HandleFunc("/panel/upstream/health", func(w http.ResponseWriter, r *http.Request) {
		status, ms, err := px.CheckUpstream(r)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "latencyMs": ms})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": status >= 200 && status < 300, "status": status, "latencyMs": ms})
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
		panelSandboxHandler(px, w, r)
	})))
	registerTerminalRoute(mux, px, authed)
	mux.Handle("/sandbox-proxy/", authed(http.HandlerFunc(px.SandboxPortProxy)))

	mux.Handle("/", spaHandler(cfg.StaticDir))

	return withRequestLog(mux)
}

func panelSandboxHandler(px *proxy.Proxy, w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	id := parts[2]
	action := strings.Join(parts[3:], "/")

	switch {
	case r.Method == http.MethodPost && action == "vscode/start":
		startVSCode(px, w, r, id)
	case r.Method == http.MethodPost && action == "exec":
		proxyExec(px, w, r, id)
	case r.Method == http.MethodGet && action == "endpoint":
		resolveEndpointHandler(px, w, r, id)
	case r.Method == http.MethodPost && action == "git-clone":
		gitClone(px, w, r, id)
	case r.Method == http.MethodGet && action == "ports":
		listPorts(px, w, r, id)
	case r.Method == http.MethodGet && action == "logs":
		getLogs(px, w, r, id)
	case r.Method == http.MethodGet && action == "events":
		getEvents(px, w, r, id)
	case r.Method == http.MethodGet && action == "metrics":
		getMetrics(px, w, r, id)
	case r.Method == http.MethodGet && action == "metrics/watch":
		watchMetrics(px, w, r, id)
	case r.Method == http.MethodGet && action == "files":
		listFiles(px, w, r, id)
	case r.Method == http.MethodGet && action == "files/read":
		readFile(px, w, r, id)
	case r.Method == http.MethodPost && action == "files/write":
		writeFile(px, w, r, id)
	case r.Method == http.MethodPost && action == "files/upload":
		uploadFile(px, w, r, id)
	case r.Method == http.MethodGet && action == "files/download":
		downloadFile(px, w, r, id)
	case r.Method == http.MethodDelete && action == "files":
		deleteFile(px, w, r, id)
	case r.Method == http.MethodPost && action == "files/mkdir":
		mkdirHandler(px, w, r, id)
	case r.Method == http.MethodDelete && strings.HasPrefix(action, "cache"):
		px.InvalidateSandbox(id)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func startVSCode(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	check, err := px.RunInExecd(r, id, "pgrep -x code-server >/dev/null 2>&1 && echo running || echo stopped", false, 5000)
	if err == nil && len(check.Stdout) > 0 && strings.HasPrefix(check.Stdout[0], "running") {
		writeJSON(w, http.StatusOK, map[string]any{
			"port":    8443,
			"url":     fmt.Sprintf("/sandbox-proxy/%s/port/8443/?folder=/workspace", id),
			"message": "code-server already running",
		})
		return
	}
	cmd := "code-server --bind-addr 0.0.0.0:8443 --auth none /workspace"
	if _, err := px.RunInExecd(r, id, cmd, true, 10000); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "exec_failed", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"port":    8443,
		"url":     fmt.Sprintf("/sandbox-proxy/%s/port/8443/?folder=/workspace", id),
		"message": "code-server start requested",
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
	res, err := px.RunInExecd(r, id, body.Command, body.Background, body.TimeoutMs)
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
	resp, err := px.DoUpstream(r, http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s/endpoints/%s", id, port), nil, &payload)
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

func gitClone(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		URL    string `json:"url"`
		Ref    string `json:"ref"`
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.URL == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}
	target := body.Target
	if target == "" {
		target = "/workspace"
	}
	ref := body.Ref
	if ref == "" {
		ref = "HEAD"
	}

	// Two strategies:
	//   1. If git is present, use a normal clone.
	//   2. Otherwise fall back to downloading a codeload/GitHub tarball which
	//      works on any image with `curl` or `wget`.
	tarURL := tarballURL(body.URL, ref)
	cmd := fmt.Sprintf(`set -e
TARGET=%s
URL=%s
REF=%s
TAR=%s
mkdir -p "$TARGET"
if command -v git >/dev/null 2>&1; then
  if [ -d "$TARGET/.git" ]; then
    (cd "$TARGET" && git fetch --depth=1 origin "$REF" && git reset --hard FETCH_HEAD)
  else
    git clone --depth=1 ${REF:+--branch "$REF"} "$URL" "$TARGET" 2>&1
  fi
elif [ -n "$TAR" ]; then
  TMP="$(mktemp -t osbui-clone.XXXXXX.tar.gz)"
  trap 'rm -f "$TMP"' EXIT
  if command -v curl >/dev/null 2>&1; then
    curl -fsSLk -o "$TMP" "$TAR"
  elif command -v wget >/dev/null 2>&1; then
    wget --no-check-certificate -qO "$TMP" "$TAR"
  else
    echo "neither git, curl, nor wget available in sandbox" >&2
    exit 2
  fi
  mkdir -p "$TARGET"
  tar -xzf "$TMP" -C "$TARGET" --strip-components=1
else
  echo "no git available and repo is not a GitHub URL — cannot clone" >&2
  exit 2
fi
echo "cloned $URL into $TARGET"
`, shellQuote(target), shellQuote(body.URL), shellQuote(ref), shellQuote(tarURL))
	res, err := px.RunInExecd(r, id, cmd, false, 300000)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "clone_failed", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// tarballURL turns a GitHub repo URL into a codeload tarball URL so we can
// bootstrap without git. Returns "" for non-GitHub URLs.
func tarballURL(repoURL, ref string) string {
	u, err := url.Parse(repoURL)
	if err != nil || u.Host != "github.com" {
		return ""
	}
	p := strings.TrimSuffix(u.Path, ".git")
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) < 2 {
		return ""
	}
	if ref == "" || ref == "HEAD" {
		ref = "HEAD"
	}
	return fmt.Sprintf("https://codeload.github.com/%s/%s/tar.gz/%s", parts[0], parts[1], ref)
}

func listPorts(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	// Parse /proc/net/tcp and /proc/net/tcp6 for LISTEN sockets (state 0A).
	cmd := "{ cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4==\"0A\"{print $2}' | while read e; do p=${e#*:}; echo $((16#$p)); done; } | sort -nu"
	res, err := px.RunInExecd(r, id, cmd, false, 5000)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "exec_failed", "message": err.Error()})
		return
	}
	ports := []int{}
	for _, line := range res.Stdout {
		for _, p := range strings.Fields(strings.TrimSpace(line)) {
			if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
				ports = append(ports, n)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ports": ports})
}

type diagResp struct {
	SandboxId   string `json:"sandboxId"`
	Kind        string `json:"kind"`
	Scope       string `json:"scope"`
	Delivery    string `json:"delivery"`
	Content     string `json:"content"`
	ContentURL  string `json:"contentUrl"`
	ContentType string `json:"contentType"`
	Truncated   bool   `json:"truncated"`
}

func fetchDiagnostic(px *proxy.Proxy, r *http.Request, id, kind, scope string) (*diagResp, int, error) {
	qs := ""
	if scope != "" {
		qs = "?scope=" + url.QueryEscape(scope)
	}
	// Issue the request ourselves so we can handle both JSON descriptors and
	// plain-text responses (some runtimes return raw log text).
	resp, err := px.DoUpstream(r, http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s/diagnostics/%s%s", id, kind, qs), nil, nil)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	dr := &diagResp{SandboxId: id, Kind: kind, Scope: scope, Delivery: "inline", ContentType: resp.Header.Get("Content-Type")}
	if strings.Contains(dr.ContentType, "application/json") {
		if err := json.Unmarshal(data, dr); err != nil {
			// Fall back to treating the body as plain text.
			dr.Content = string(data)
		}
	} else {
		dr.Content = string(data)
	}
	return dr, resp.StatusCode, nil
}

func getLogs(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "container"
	}
	dr, status, err := fetchDiagnostic(px, r, id, "logs", scope)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "logs_failed", "message": err.Error()})
		return
	}
	if status < 200 || status >= 300 {
		writeJSON(w, status, map[string]string{"error": "upstream_error"})
		return
	}
	writeJSON(w, http.StatusOK, dr)
}

func getEvents(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "runtime"
	}
	dr, status, err := fetchDiagnostic(px, r, id, "events", scope)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "events_failed", "message": err.Error()})
		return
	}
	if status < 200 || status >= 300 {
		writeJSON(w, status, map[string]string{"error": "upstream_error"})
		return
	}
	writeJSON(w, http.StatusOK, dr)
}

func getMetrics(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodGet, "/metrics", nil, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "metrics_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func watchMetrics(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	err := px.StreamExecdSSE(ctx, r, id, "/metrics/watch", nil, func(line []byte) error {
		if len(bytes.TrimSpace(line)) == 0 {
			return nil
		}
		fmt.Fprintf(w, "data: %s\n\n", string(line))
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	})
	if err != nil && err != context.Canceled && !isClientGone(err) {
		log.Printf("metrics stream for %s ended: %v", id, err)
	}
}

func isClientGone(err error) bool {
	s := err.Error()
	return strings.Contains(s, "context canceled") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "connection reset")
}

// File ops --------------------------------------------------------------

func listFiles(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	p := r.URL.Query().Get("path")
	if p == "" {
		p = "/workspace"
	}
	// Emit machine-parseable stat lines. We let execd run this under bash so
	// the glob expansion and `stat` flags work predictably on Alpine / Debian.
	cmd := fmt.Sprintf(`cd %s 2>/dev/null; find . -maxdepth 1 -mindepth 1 \( -type f -o -type d -o -type l \) -printf "%%f||%%y||%%s||%%T@||%%M\n" 2>/dev/null | sort`, shellQuote(p))
	res, err := px.RunInExecd(r, id, cmd, false, 10000)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "list_failed", "message": err.Error()})
		return
	}
	entries := []map[string]any{}
	for _, line := range res.Stdout {
		for _, row := range strings.Split(line, "\n") {
			row = strings.TrimSpace(row)
			if row == "" {
				continue
			}
			parts := strings.SplitN(row, "||", 5)
			if len(parts) < 5 {
				continue
			}
			size, _ := strconv.ParseInt(parts[2], 10, 64)
			mtime, _ := strconv.ParseFloat(parts[3], 64)
			typeChar := parts[1] // f / d / l / b / c / p / s
			kind := "file"
			isDir := false
			isLink := false
			switch typeChar {
			case "d":
				kind = "directory"
				isDir = true
			case "l":
				kind = "symlink"
				isLink = true
			}
			entries = append(entries, map[string]any{
				"name":   parts[0],
				"type":   kind,
				"size":   size,
				"mtime":  int64(mtime),
				"mode":   parts[4],
				"isDir":  isDir,
				"isLink": isLink,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": p, "entries": entries})
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func readFile(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodGet, "/files/download?path="+url.QueryEscape(p), nil, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "read_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.Header().Del("X-Frame-Options")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// buildExecdUploadBody builds a multipart body shaped the way execd expects:
// both the metadata JSON and the file contents must be sent as file parts
// (the metadata field name is "metadata" with a filename, not just a form
// field — otherwise execd returns INVALID_FILE_METADATA). Returns the buffer
// and the multipart Content-Type including the boundary.
func buildExecdUploadBody(meta map[string]any, filename string, content io.Reader) (*bytes.Buffer, string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	metaJSON, _ := json.Marshal(meta)

	metaHdr := make(map[string][]string)
	metaHdr["Content-Disposition"] = []string{`form-data; name="metadata"; filename="metadata.json"`}
	metaHdr["Content-Type"] = []string{"application/json"}
	metaPart, err := mw.CreatePart(metaHdr)
	if err != nil {
		return nil, "", err
	}
	if _, err := metaPart.Write(metaJSON); err != nil {
		return nil, "", err
	}

	fileHdr := make(map[string][]string)
	fileHdr["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name="file"; filename=%q`, filename)}
	fileHdr["Content-Type"] = []string{"application/octet-stream"}
	filePart, err := mw.CreatePart(fileHdr)
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(filePart, content); err != nil {
		return nil, "", err
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}
	return &buf, mw.FormDataContentType(), nil
}

func writeFile(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Mode    int    `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	if body.Mode == 0 {
		body.Mode = 644 // execd interprets the integer's digits as octal mode bits
	}
	buf, ct, err := buildExecdUploadBody(
		map[string]any{"path": body.Path, "mode": body.Mode},
		filepath.Base(body.Path),
		strings.NewReader(body.Content),
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "body_build_failed", "message": err.Error()})
		return
	}
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodPost, "/files/upload", buf, ct)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "write_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeJSON(w, resp.StatusCode, map[string]any{"error": "upstream_error", "body": string(data)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func uploadFile(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		http.Error(w, "multipart parse: "+err.Error(), http.StatusBadRequest)
		return
	}
	targetDir := r.FormValue("path")
	if targetDir == "" {
		targetDir = "/workspace"
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "no files", http.StatusBadRequest)
		return
	}
	results := []map[string]any{}
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			results = append(results, map[string]any{"name": fh.Filename, "error": err.Error()})
			continue
		}
		dst := strings.TrimRight(targetDir, "/") + "/" + fh.Filename
		buf, ct, err := buildExecdUploadBody(
			map[string]any{"path": dst, "mode": 644},
			fh.Filename, f,
		)
		f.Close()
		if err != nil {
			results = append(results, map[string]any{"name": fh.Filename, "error": err.Error()})
			continue
		}
		resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodPost, "/files/upload", buf, ct)
		if err != nil {
			results = append(results, map[string]any{"name": fh.Filename, "error": err.Error()})
			continue
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			results = append(results, map[string]any{"name": fh.Filename, "error": fmt.Sprintf("status %d: %s", resp.StatusCode, string(b))})
			continue
		}
		results = append(results, map[string]any{"name": fh.Filename, "path": dst, "size": fh.Size})
	}
	writeJSON(w, http.StatusOK, map[string]any{"uploaded": results, "targetDir": targetDir})
}

func downloadFile(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodGet, "/files/download?path="+url.QueryEscape(p), nil, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "download_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.Header().Del("X-Frame-Options")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filepath.Base(p)))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func deleteFile(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	p := r.URL.Query().Get("path")
	isDir := r.URL.Query().Get("isDir") == "1"
	if p == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	endpoint := "/files"
	if isDir {
		endpoint = "/directories"
	}
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodDelete, endpoint+"?path="+url.QueryEscape(p), nil, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "delete_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		writeJSON(w, resp.StatusCode, map[string]any{"error": "upstream_error", "body": string(b)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func mkdirHandler(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Path string `json:"path"`
		Mode int    `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	if body.Mode == 0 {
		body.Mode = 755
	}
	req := map[string]any{body.Path: map[string]any{"mode": body.Mode}}
	data, _ := json.Marshal(req)
	resp, err := px.ExecdRequest(r.Context(), r, id, http.MethodPost, "/directories", bytes.NewReader(data), "application/json")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "mkdir_failed", "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		writeJSON(w, resp.StatusCode, map[string]any{"error": "upstream_error", "body": string(b)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Static + helpers ------------------------------------------------------

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
	io.Copy(w, bytes.NewReader(data))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func maskKey(k string) string {
	if k == "" {
		return ""
	}
	if len(k) <= 4 {
		return strings.Repeat("*", len(k))
	}
	return k[:2] + strings.Repeat("*", len(k)-4) + k[len(k)-2:]
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
