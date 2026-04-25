package proxy

import (
	"bufio"
	"bytes"
	"context"
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

const (
	apiKeyHeader      = "OPEN-SANDBOX-API-KEY"
	upstreamHeader    = "X-Panel-Upstream"
	upstreamAPIHeader = "X-Panel-API-Key"
)

// Proxy wires together the upstream OpenSandbox lifecycle server and the
// per-sandbox endpoint reverse proxies used for accessing services such as
// VS Code Web.
type Proxy struct {
	cfg       config.Config
	upstream  *url.URL
	transport *http.Transport

	endpointCache sync.Map // key: sandboxID|port -> *endpointCacheEntry
}

type endpointCacheEntry struct {
	target   *url.URL
	basePath string // e.g. "/proxy/8443" or "" for direct
	expires  time.Time
}

// New constructs a configured proxy.
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
	return p, nil
}

// RuntimeConfig returns the effective upstream + API key for a request.
// Per-request overrides (cookie osb_upstream / osb_apikey or header X-Panel-*)
// take precedence over the server flags so the panel can be reconfigured at
// runtime without a restart.
func (p *Proxy) RuntimeConfig(r *http.Request) (upstream string, apiKey string) {
	upstream = p.cfg.Upstream
	apiKey = p.cfg.APIKey
	if v := readOverride(r, "osb_upstream", upstreamHeader); v != "" {
		upstream = strings.TrimRight(v, "/")
	}
	if v := readOverride(r, "osb_apikey", upstreamAPIHeader); v != "" {
		apiKey = v
	}
	return
}

func readOverride(r *http.Request, cookieName, headerName string) string {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get(headerName); h != "" {
		return h
	}
	return ""
}

// APIProxy proxies /api/* requests to the upstream server.
func (p *Proxy) APIProxy(w http.ResponseWriter, r *http.Request) {
	upstream, apiKey := p.RuntimeConfig(r)
	u, err := url.Parse(upstream)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "bad_upstream", "message": err.Error()})
		return
	}
	rp := &httputil.ReverseProxy{
		Transport:     p.transport,
		FlushInterval: 100 * time.Millisecond,
		Director: func(req *http.Request) {
			req.URL.Scheme = u.Scheme
			req.URL.Host = u.Host
			req.Host = u.Host
			if apiKey != "" {
				req.Header.Set(apiKeyHeader, apiKey)
			}
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api")
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("X-Frame-Options")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_unreachable", "message": err.Error()})
		},
	}
	rp.ServeHTTP(w, r)
}

// DoUpstream issues a direct request honoring per-request config overrides.
func (p *Proxy) DoUpstream(r *http.Request, method, path string, body io.Reader, out any) (*http.Response, error) {
	upstream, apiKey := p.RuntimeConfig(r)
	req, err := http.NewRequest(method, upstream+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set(apiKeyHeader, apiKey)
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

// CheckUpstream pings the upstream health endpoint.
func (p *Proxy) CheckUpstream(r *http.Request) (status int, latencyMs int64, err error) {
	upstream, _ := p.RuntimeConfig(r)
	start := time.Now()
	req, _ := http.NewRequest(http.MethodGet, upstream+"/health", nil)
	client := &http.Client{Transport: p.transport, Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, time.Since(start).Milliseconds(), err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, time.Since(start).Milliseconds(), nil
}

func (p *Proxy) cacheKey(sandboxID, port string) string { return sandboxID + "|" + port }

// resolveEndpoint asks the upstream server where the given sandbox port lives.
func (p *Proxy) resolveEndpoint(r *http.Request, sandboxID, port string) (*endpointCacheEntry, error) {
	key := p.cacheKey(sandboxID, port)
	if v, ok := p.endpointCache.Load(key); ok {
		e := v.(*endpointCacheEntry)
		if time.Now().Before(e.expires) {
			return e, nil
		}
	}
	var payload struct {
		Endpoint string            `json:"endpoint"`
		Headers  map[string]string `json:"headers"`
	}
	resp, err := p.DoUpstream(r, http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s/endpoints/%s", sandboxID, port), nil, &payload)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream returned %d resolving endpoint", resp.StatusCode)
	}
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

// InvalidateSandbox drops cached endpoint resolutions for a sandbox.
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
func (p *Proxy) SandboxPortProxy(w http.ResponseWriter, r *http.Request) {
	sandboxID, port, rest, ok := parseSandboxProxyPath(r.URL.Path)
	if !ok {
		http.Error(w, "invalid sandbox proxy path", http.StatusBadRequest)
		return
	}
	entry, err := p.resolveEndpoint(r, sandboxID, port)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "endpoint_resolve_failed", "message": err.Error()})
		return
	}
	rp := &httputil.ReverseProxy{
		Transport:     p.transport,
		FlushInterval: 100 * time.Millisecond,
		Director: func(req *http.Request) {
			req.URL.Scheme = entry.target.Scheme
			req.URL.Host = entry.target.Host
			req.Host = entry.target.Host
			if rest == "" {
				rest = "/"
			}
			req.URL.Path = singleJoin(entry.basePath, rest)
			if origin := req.Header.Get("Origin"); origin != "" {
				req.Header.Set("Origin", entry.target.Scheme+"://"+entry.target.Host)
			}
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

func parseSandboxProxyPath(p string) (id, port, rest string, ok bool) {
	const prefix = "/sandbox-proxy/"
	if !strings.HasPrefix(p, prefix) {
		return "", "", "", false
	}
	trimmed := p[len(prefix):]
	segs := strings.SplitN(trimmed, "/", 4)
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

type ExecResult struct {
	ExitCode int      `json:"exitCode"`
	Stdout   []string `json:"stdout"`
	Stderr   []string `json:"stderr"`
	Error    string   `json:"error,omitempty"`
}

// ResolveExecdBase returns the base URL (scheme+host) of the sandbox's execd.
// It prefers the sandbox metadata key `opensandbox.io/embedding-proxy-port`
// and falls back to resolving an arbitrary port and stripping the `/proxy/<p>`
// suffix.
func (p *Proxy) ResolveExecdBase(r *http.Request, sandboxID string) (*url.URL, error) {
	type sandbox struct {
		Metadata map[string]string `json:"metadata"`
	}
	var sb sandbox
	resp, err := p.DoUpstream(r, http.MethodGet, fmt.Sprintf("/v1/sandboxes/%s", sandboxID), nil, &sb)
	if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if port, ok := sb.Metadata["opensandbox.io/embedding-proxy-port"]; ok && port != "" {
			if u, err := url.Parse("http://127.0.0.1:" + port); err == nil {
				return u, nil
			}
		}
	}
	entry, err := p.resolveEndpoint(r, sandboxID, "65535")
	if err != nil {
		return nil, fmt.Errorf("resolve execd base: %w", err)
	}
	return entry.target, nil
}

// RunInExecd issues a command via the sandbox's execd.
func (p *Proxy) RunInExecd(r *http.Request, sandboxID, command string, bg bool, timeoutMs int) (*ExecResult, error) {
	base, err := p.ResolveExecdBase(r, sandboxID)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"command": command, "background": bg}
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
	return parseExecdSSE(resp.Body, bg)
}

func parseExecdSSE(body io.Reader, bg bool) (*ExecResult, error) {
	result := &ExecResult{Stdout: []string{}, Stderr: []string{}}
	scanner := bufio.NewScanner(body)
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
			_ = bg
		}
	}
	return result, scanner.Err()
}

// ExecdRequest proxies a raw HTTP request to the sandbox's execd.
func (p *Proxy) ExecdRequest(ctx context.Context, r *http.Request, sandboxID, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	base, err := p.ResolveExecdBase(r, sandboxID)
	if err != nil {
		return nil, err
	}
	target := strings.TrimRight(base.String(), "/") + path
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := &http.Client{Transport: p.transport, Timeout: 300 * time.Second}
	return client.Do(req)
}

// StreamExecdSSE opens an SSE stream from the sandbox's execd and forwards
// each event to the callback until the context is canceled or the upstream
// closes. It returns when the upstream stream ends.
func (p *Proxy) StreamExecdSSE(ctx context.Context, r *http.Request, sandboxID, path string, body io.Reader, onEvent func(line []byte) error) error {
	base, err := p.ResolveExecdBase(r, sandboxID)
	if err != nil {
		return err
	}
	target := strings.TrimRight(base.String(), "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, body)
	if err != nil {
		return err
	}
	client := &http.Client{Transport: p.transport}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("execd %s returned %d: %s", path, resp.StatusCode, string(b))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := onEvent(scanner.Bytes()); err != nil {
			return err
		}
	}
	return scanner.Err()
}
