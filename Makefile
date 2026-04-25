.PHONY: all build build-frontend build-backend run dev clean install-frontend

SHELL := /bin/bash
VERSION ?= dev
STATIC_DIR ?= $(CURDIR)/frontend/dist
LISTEN ?= 0.0.0.0:5173

all: build

install-frontend:
	cd frontend && npm install

build-frontend: install-frontend
	cd frontend && npm run build

build-backend:
	cd backend && go build -ldflags "-X github.com/lyianu/osbui/backend/internal/server.Version=$(VERSION)" -o ../osbui-panel .

build: build-frontend build-backend

run: build
	./osbui-panel \
		-listen $(LISTEN) \
		-static $(STATIC_DIR) \
		$(if $(OSBUI_UPSTREAM),-upstream $(OSBUI_UPSTREAM),) \
		$(if $(OSBUI_API_KEY),-api-key $(OSBUI_API_KEY),) \
		$(if $(OSBUI_PANEL_SECRET),-panel-secret $(OSBUI_PANEL_SECRET),)

# Backend hot-reload dev workflow:
#   1. Run OpenSandbox server on http://127.0.0.1:8080 separately.
#   2. `make dev-backend` runs the Go backend on :5173.
#   3. `make dev-frontend` runs Vite on :5174 proxying /api, /panel, /sandbox-proxy → :5173.
dev-backend: build-backend
	OSBUI_UPSTREAM=$${OSBUI_UPSTREAM:-http://127.0.0.1:8080} \
	OSBUI_API_KEY=$${OSBUI_API_KEY:-local-dev-key} \
	./osbui-panel -listen 127.0.0.1:5173 -static $(STATIC_DIR)

dev-frontend: install-frontend
	cd frontend && npm run dev

clean:
	rm -rf osbui-panel frontend/dist
