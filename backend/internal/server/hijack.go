package server

import (
	"bufio"
	"crypto/sha1"
	"errors"
	"hash"
	"io"
	"net"
	"net/http"
)

// hijack returns a net.Conn plus a bufio.ReadWriter for low-level protocol
// upgrades (WebSocket). The statusRecorder wrapper used elsewhere implements
// http.Hijacker so unwrapping works through it.
func hijack(w http.ResponseWriter) (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hj.Hijack()
}

func sha1Start() hash.Hash { return sha1.New() }

var _ io.Writer = (*bufio.Writer)(nil)
