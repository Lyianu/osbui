package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/lyianu/osbui/backend/internal/config"
)

const apiKeyHeader = "OPEN-SANDBOX-API-KEY"

// Proxy wires together the upstream OpenSandbox lifecycle server and the
// per-sandbox endpoint reverse proxies used for accessing services such as
// VS Code Web.
type Proxy struct {
	cfg       config.Config
	upstream  *url.URL
	transport *http.Transport

	upstreamRP *httputil.ReverseProxy

	endpointCache sync.Map // key: sandboxId|port -> *endpointCacheEntry
}

type endpointCacheEntry struct {
	target  *url.URL
	basePath string // e.g. "/proxy/8443" or "" for direct
	expires  time.Time
}

// New constructs a configured proxy. It returns an error if the upstream
// URL cannot be parsed.
func New(cfg config.Config) (*Proxy, error) {
	if cfg.Upstream == "" {
		return nil, errors.New("upstream must be configured")
	}
	u, err := url.Parse(cfg.Upstream)
	if err != nil {
		return nil, fmt.Errorf("parse upstream: %w", err)
	}
	p := &Proxy{
		cfg:      cfg,
		upstream: u,
		transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   10 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          128,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
		},
	}
	p.upstreamRP = &httputil.ReverseProxy{
		Transport:    p.transport,
		FlushInterval: 100 * time.Millisecond,
		Director: func(req *http.Request) {
			req.URL.Scheme = u.Scheme
			req.URL.Host = u.Host
			req.Host = u.Host
			if cfg.APIKey != "" {
				req.Header.Set(apiKeyHeader, cfg.APIKey)
			}
			// Strip /api prefix.
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api")
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			// Some upstream errors use chunked; we pass through as-is but drop
			// hop-by-hop headers.
			resp.Header.Del("X-Frame-Options")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_unreachable", "message": err.Error()})
		},
	}
	return p, nil
}

// APIProxy proxies /api/* requests to the configured OpenSandbox server.
func (p *Proxy) APIProxy(w http.ResponseWriter, r *http.Request) {
	p.upstreamRP.ServeHTTP(w, r)
}

// DoUpstream performs a direct request to the upstream server and returns the
// decoded JSON body or an error.
func (p *Proxy) DoUpstream(method, path string, body io.Reader, out any) (*http.Response, error) {
	req, err := http.NewRequest(method, p.cfg.Upstream+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.cfg.APIKey != "" {
		req.Header.Set(apiKeyHeader, p.cfg.APIKey)
	}
	client := &http.Client{Transport: p.transport, Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if out != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 && resp.ContentLength != 0 {
		data, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return resp, err
		}
		if len(bytes.TrimSpace(data)) > 0 {
			if err := json.Unmarshal(data, out); err != nil {
				return resp, fmt.Errorf("decode %s %s: %w", method, path, err)
			}
		}
	}
	return resp, nil
}

func (p *Proxy) cacheKey(sandboxID, port string) string {
	return sandboxID + "|" + port
}

// resolveEndpoint asks the upstream server where the given sandbox port lives
// and caches the resolution.
func (p *Proxy) resolveEndpoint(sandboxID, port string) (*endpointCacheEntry, error) {
	key := p.cacheKey(sandboxID, port)
	if v, ok := p.endpointCache.Load(key); ok {
		entry := v.(*endpointCacheEntry)
		if time.Now().Before(entry.expires) {
			return entry, nil
		}
	}

	var payload struct {
		Endpoint string            `json:"endpoint"`
		Headers  map[string]string `json:"headers"`
	}
	resp, err := p.DoUpstream(http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s/endpoints/%s", sandboxID, port), nil, &payload)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream returned %d resolving endpoint", resp.StatusCode)
	}
	// payload.Endpoint may be of the form "127.0.0.1:52672" OR "127.0.0.1:52672/proxy/8443".
	raw := payload.Endpoint
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse endpoint %q: %w", payload.Endpoint, err)
	}
	entry := &endpointCacheEntry{
		target:   &url.URL{Scheme: u.Scheme, Host: u.Host},
		basePath: strings.TrimRight(u.Path, "/"),
		expires:  time.Now().Add(30 * time.Second),
	}
	p.endpointCache.Store(key, entry)
	return entry, nil
}

// InvalidateSandbox drops cached endpoint resolutions for a sandbox (called
// after delete).
func (p *Proxy) InvalidateSandbox(sandboxID string) {
	prefix := sandboxID + "|"
	p.endpointCache.Range(func(k, _ any) bool {
		if strings.HasPrefix(k.(string), prefix) {
			p.endpointCache.Delete(k)
		}
		return true
	})
}

// SandboxPortProxy reverse-proxies a request to a port inside a sandbox.
// It expects URLs shaped like /sandbox-proxy/<id>/port/<port>/<rest>.
func (p *Proxy) SandboxPortProxy(w http.ResponseWriter, r *http.Request) {
	sandboxID, port, rest, ok := parseSandboxProxyPath(r.URL.Path)
	if !ok {
		http.Error(w, "invalid sandbox proxy path", http.StatusBadRequest)
		return
	}

	entry, err := p.resolveEndpoint(sandboxID, port)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "endpoint_resolve_failed", "message": err.Error()})
		return
	}

	// Handle WebSocket upgrade separately — httputil.ReverseProxy supports it
	// out of the box only when Hop-by-hop headers are preserved. We let
	// ReverseProxy handle it.
	rp := &httputil.ReverseProxy{
		Transport:     p.transport,
		FlushInterval: 100 * time.Millisecond,
		Director: func(req *http.Request) {
			req.URL.Scheme = entry.target.Scheme
			req.URL.Host = entry.target.Host
			req.Host = entry.target.Host
			// rest already begins with "/" or is empty
			if rest == "" {
				rest = "/"
			}
			req.URL.Path = singleJoin(entry.basePath, rest)
			// Rewrite Origin for same-origin checks inside services that refuse
			// cross-origin WebSocket upgrades (notably code-server). Without
			// this, requests from the panel's origin get 403'd at the upgrade.
			if origin := req.Header.Get("Origin"); origin != "" {
				req.Header.Set("Origin", entry.target.Scheme+"://"+entry.target.Host)
			}
			// Drop the Referer — it leaks the panel origin and is otherwise
			// not meaningful to the sandbox.
			req.Header.Del("Referer")
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("X-Frame-Options")
			if loc := resp.Header.Get("Location"); loc != "" {
				resp.Header.Set("Location", rewriteLocation(loc, entry.basePath, sandboxID, port))
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "sandbox_unreachable", "message": err.Error()})
		},
	}
	rp.ServeHTTP(w, r)
}

// parseSandboxProxyPath splits "/sandbox-proxy/<id>/port/<port>/..." into its
// parts.
func parseSandboxProxyPath(p string) (id, port, rest string, ok bool) {
	// Require prefix.
	const prefix = "/sandbox-proxy/"
	if !strings.HasPrefix(p, prefix) {
		return "", "", "", false
	}
	trimmed := p[len(prefix):]
	segs := strings.SplitN(trimmed, "/", 4)
	// We need at least id, "port", port.
	if len(segs) < 3 || segs[1] != "port" {
		return "", "", "", false
	}
	id = segs[0]
	port = segs[2]
	if len(segs) == 4 {
		rest = "/" + segs[3]
	} else {
		rest = "/"
	}
	return id, port, rest, true
}

func singleJoin(a, b string) string {
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	return path.Join("/"+strings.TrimLeft(a, "/"), b)
}

// rewriteLocation rewrites absolute redirect URLs from the sandbox origin so
// browsers stay on the panel origin. Relative paths are returned unchanged
// because the browser resolves them against the current URL.
func rewriteLocation(loc, upstreamBase, sandboxID, port string) string {
	if loc == "" {
		return loc
	}
	if strings.HasPrefix(loc, "http://") || strings.HasPrefix(loc, "https://") {
		u, err := url.Parse(loc)
		if err != nil {
			return loc
		}
		p := strings.TrimPrefix(u.Path, upstreamBase)
		return fmt.Sprintf("/sandbox-proxy/%s/port/%s%s", sandboxID, port, p)
	}
	// Absolute path rewrite: if upstream sends /proxy/8443/..., rewrite to our prefix.
	if upstreamBase != "" && strings.HasPrefix(loc, upstreamBase+"/") {
		trimmed := strings.TrimPrefix(loc, upstreamBase)
		return fmt.Sprintf("/sandbox-proxy/%s/port/%s%s", sandboxID, port, trimmed)
	}
	return loc
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// --- Execd bridge --------------------------------------------------------
//
// The management panel needs to issue commands (e.g. start code-server) to the
// execd sidecar of a sandbox. The sidecar is reachable through the per-sandbox
// ingress proxy port which the server records in sandbox metadata under the
// key `opensandbox.io/embedding-proxy-port`. When that metadata is unavailable
// (e.g. older server builds) we fall back to resolving any non-8080 port and
// stripping its `/proxy/<port>` suffix to recover the execd base URL.

type ExecResult struct {
	ExitCode int      `json:"exitCode"`
	Stdout   []string `json:"stdout"`
	Stderr   []string `json:"stderr"`
	Error    string   `json:"error,omitempty"`
}

// resolveExecdBase returns the scheme://host[:port] base URL that speaks the
// execd HTTP API for the given sandbox.
func (p *Proxy) resolveExecdBase(sandboxID string) (*url.URL, error) {
	// First try the sandbox's metadata.
	type sandbox struct {
		Metadata map[string]string `json:"metadata"`
	}
	var sb sandbox
	resp, err := p.DoUpstream(http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s", sandboxID), nil, &sb)
	if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if port, ok := sb.Metadata["opensandbox.io/embedding-proxy-port"]; ok && port != "" {
			u, err := url.Parse("http://127.0.0.1:" + port)
			if err == nil {
				return u, nil
			}
		}
	}
	// Fallback: resolve a non-system port and strip /proxy/<port>.
	entry, err := p.resolveEndpoint(sandboxID, "65535")
	if err != nil {
		return nil, fmt.Errorf("resolve execd base: %w", err)
	}
	return entry.target, nil
}

// RunInExecd issues a command via the sandbox's execd. `bg=true` returns
// immediately after the command is accepted. For foreground commands this
// blocks until execution_complete is received or the read exceeds the timeout.
func (p *Proxy) RunInExecd(sandboxID, command string, bg bool, timeoutMs int) (*ExecResult, error) {
	base, err := p.resolveExecdBase(sandboxID)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"command":    command,
		"background": bg,
	}
	if timeoutMs > 0 {
		body["timeout"] = timeoutMs
	}
	data, _ := json.Marshal(body)
	target := strings.TrimRight(base.String(), "/") + "/command"
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: p.transport, Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("execd returned %d: %s", resp.StatusCode, string(b))
	}

	result := &ExecResult{Stdout: []string{}, Stderr: []string{}}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ExitCode *int   `json:"exit_code"`
			Error    string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "stdout":
			result.Stdout = append(result.Stdout, ev.Text)
		case "stderr":
			result.Stderr = append(result.Stderr, ev.Text)
		case "execution_complete":
			if ev.ExitCode != nil {
				result.ExitCode = *ev.ExitCode
			}
			if ev.Error != "" {
				result.Error = ev.Error
			}
			return result, nil
		case "error":
			result.Error = ev.Text
		}
		if bg && ev.Type == "init" {
			// Background commands complete almost immediately after init.
		}
	}
	if err := scanner.Err(); err != nil {
		return result, err
	}
	return result, nil
}
