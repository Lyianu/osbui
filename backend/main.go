package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/lyianu/osbui/backend/internal/config"
	"github.com/lyianu/osbui/backend/internal/proxy"
	"github.com/lyianu/osbui/backend/internal/server"
)

func main() {
	var (
		listenAddr  = flag.String("listen", "0.0.0.0:5173", "Address for the management UI to listen on")
		upstream    = flag.String("upstream", envOr("OSBUI_UPSTREAM", "http://127.0.0.1:8080"), "OpenSandbox server base URL")
		apiKey      = flag.String("api-key", os.Getenv("OSBUI_API_KEY"), "OpenSandbox API key")
		staticDir   = flag.String("static", envOr("OSBUI_STATIC", "./frontend/dist"), "Directory with compiled frontend assets")
		panelSecret = flag.String("panel-secret", os.Getenv("OSBUI_PANEL_SECRET"), "Optional shared secret for accessing the panel")
	)
	flag.Parse()

	cfg := config.Config{
		Listen:      *listenAddr,
		Upstream:    strings.TrimRight(*upstream, "/"),
		APIKey:      *apiKey,
		StaticDir:   *staticDir,
		PanelSecret: *panelSecret,
	}

	px, err := proxy.New(cfg)
	if err != nil {
		log.Fatalf("proxy init failed: %v", err)
	}

	mux := server.Routes(cfg, px)

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("osbui panel listening on %s (upstream=%s, static=%s)", cfg.Listen, cfg.Upstream, cfg.StaticDir)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("osbui panel stopped")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
