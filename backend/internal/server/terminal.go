package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/lyianu/osbui/backend/internal/proxy"
)

// WebSocket terminal support ---------------------------------------------
//
// We implement just enough of RFC 6455 (server-side, unfragmented text
// frames) to drive an xterm.js client. Each incoming text frame is a JSON
// message:
//   {"type":"input","data":"ls\n"}
//   {"type":"resize","cols":80,"rows":24}
//
// The backend maintains an execd bash session per WebSocket and streams the
// SSE output back as {"type":"output","data":"..."} frames.

func registerTerminalRoute(mux *http.ServeMux, px *proxy.Proxy, authed func(http.Handler) http.Handler) {
	mux.Handle("/panel/terminal/", authed(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// /panel/terminal/<sandboxId>
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 3 {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		handleTerminalWS(px, w, r, parts[2])
	})))
}

func handleTerminalWS(px *proxy.Proxy, w http.ResponseWriter, r *http.Request, sandboxID string) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "websocket required", http.StatusBadRequest)
		return
	}
	conn, rwbuf, err := hijack(w)
	if err != nil {
		http.Error(w, "hijack: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer conn.Close()

	acceptKey := wsAccept(r.Header.Get("Sec-WebSocket-Key"))
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n"
	if _, err := rwbuf.WriteString(resp); err != nil {
		return
	}
	if err := rwbuf.Flush(); err != nil {
		return
	}

	term := &termSession{
		px:        px,
		sandboxID: sandboxID,
		r:         r,
		conn:      conn,
		writer:    rwbuf.Writer,
	}
	term.run()
}

type termSession struct {
	px        *proxy.Proxy
	sandboxID string
	r         *http.Request
	conn      io.ReadWriteCloser
	writer    *bufio.Writer
	mu        sync.Mutex
	sessionID string
	cancelCmd context.CancelFunc
}

type termFrameIn struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (t *termSession) run() {
	// Create an execd bash session.
	base, err := t.px.ResolveExecdBase(t.r, t.sandboxID)
	if err != nil {
		t.sendOutput(fmt.Sprintf("\x1b[31mfailed to resolve sandbox: %s\x1b[0m\r\n", err))
		return
	}
	createBody, _ := json.Marshal(map[string]string{"cwd": "/workspace"})
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(base.String(), "/")+"/session", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.sendOutput(fmt.Sprintf("\x1b[31mfailed to create session: %s\x1b[0m\r\n", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		t.sendOutput(fmt.Sprintf("\x1b[31mexecd session create returned %d: %s\x1b[0m\r\n", resp.StatusCode, string(body)))
		return
	}
	var cs struct {
		SessionIDCamel string `json:"sessionId"`
		SessionIDSnake string `json:"session_id"`
		ID             string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&cs)
	sid := cs.SessionIDCamel
	if sid == "" {
		sid = cs.SessionIDSnake
	}
	if sid == "" {
		sid = cs.ID
	}
	if sid == "" {
		t.sendOutput("\x1b[31mexecd session create returned no id\x1b[0m\r\n")
		return
	}
	t.sessionID = sid
	t.sendOutput(fmt.Sprintf("\x1b[32m✓ session %s attached to %s\x1b[0m\r\n$ ", sid[:8], t.sandboxID[:8]))

	for {
		frame, err := readWSFrame(t.conn)
		if err != nil {
			t.cleanup()
			return
		}
		if frame.opcode == 0x8 {
			t.cleanup()
			return
		}
		if frame.opcode != 0x1 {
			continue
		}
		var in termFrameIn
		if err := json.Unmarshal(frame.payload, &in); err != nil {
			continue
		}
		switch in.Type {
		case "input":
			go t.runCommand(in.Data)
		case "resize":
			// best-effort: shell session doesn't support resize, ignore
		}
	}
}

func (t *termSession) runCommand(cmd string) {
	base, err := t.px.ResolveExecdBase(t.r, t.sandboxID)
	if err != nil {
		t.sendOutput(fmt.Sprintf("\r\n\x1b[31m%s\x1b[0m\r\n", err))
		return
	}
	trimmed := strings.TrimRight(cmd, "\r\n")
	if trimmed == "" {
		t.sendOutput("$ ")
		return
	}
	t.sendOutput(trimmed + "\r\n")
	body, _ := json.Marshal(map[string]any{"command": trimmed, "timeout": 300000})
	ctx, cancel := context.WithTimeout(t.r.Context(), 5*time.Minute)
	t.mu.Lock()
	t.cancelCmd = cancel
	t.mu.Unlock()
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(base.String(), "/")+"/session/"+t.sessionID+"/run",
		bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.sendOutput(fmt.Sprintf("\x1b[31m%s\x1b[0m\r\n$ ", err))
		return
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "stdout":
			t.sendOutput(strings.ReplaceAll(ev.Text, "\n", "\r\n"))
		case "stderr":
			t.sendOutput("\x1b[33m" + strings.ReplaceAll(ev.Text, "\n", "\r\n") + "\x1b[0m")
		case "execution_complete":
			t.sendOutput("\r\n$ ")
			return
		}
	}
	t.sendOutput("\r\n$ ")
}

func (t *termSession) sendOutput(s string) {
	msg, _ := json.Marshal(map[string]string{"type": "output", "data": s})
	_ = writeWSText(t.conn, msg)
}

func (t *termSession) cleanup() {
	if t.sessionID == "" {
		return
	}
	base, err := t.px.ResolveExecdBase(t.r, t.sandboxID)
	if err != nil {
		return
	}
	req, _ := http.NewRequest(http.MethodDelete, strings.TrimRight(base.String(), "/")+"/session/"+t.sessionID, nil)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// Minimal RFC 6455 implementation (server side, no mask on outgoing frames,
// assumes single-frame text messages from the browser).

type wsFrame struct {
	opcode  byte
	payload []byte
}

func readWSFrame(r io.Reader) (*wsFrame, error) {
	buf := make([]byte, 2)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	opcode := buf[0] & 0x0f
	masked := buf[1]&0x80 != 0
	plen := int64(buf[1] & 0x7f)
	if plen == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, err
		}
		plen = int64(ext[0])<<8 | int64(ext[1])
	} else if plen == 127 {
		ext := make([]byte, 8)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, err
		}
		plen = 0
		for _, b := range ext {
			plen = plen<<8 | int64(b)
		}
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(r, mask[:]); err != nil {
			return nil, err
		}
	}
	payload := make([]byte, plen)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return &wsFrame{opcode: opcode, payload: payload}, nil
}

func writeWSText(w io.Writer, data []byte) error {
	var hdr []byte
	hdr = append(hdr, 0x81) // FIN + text
	l := len(data)
	switch {
	case l < 126:
		hdr = append(hdr, byte(l))
	case l <= 0xffff:
		hdr = append(hdr, 126, byte(l>>8), byte(l))
	default:
		hdr = append(hdr, 127)
		for i := 7; i >= 0; i-- {
			hdr = append(hdr, byte(l>>uint(i*8)))
		}
	}
	if _, err := w.Write(hdr); err != nil {
		return err
	}
	_, err := w.Write(data)
	return err
}

func wsAccept(key string) string {
	const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	sum := sha1Sum([]byte(key + magic))
	return base64.StdEncoding.EncodeToString(sum)
}

func sha1Sum(b []byte) []byte {
	h := sha1Start()
	h.Write(b)
	return h.Sum(nil)
}
