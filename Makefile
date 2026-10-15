# Fold — local development.
#
# Go and sqlc are not on the default PATH on macOS with Homebrew.
export PATH := /opt/homebrew/bin:$(HOME)/go/bin:$(PATH)

export ADDR ?= :8080
export LOG_LEVEL ?= debug

.PHONY: help dev db stop logs api migrate test smoke lint codegen openapi orval setup

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install toolchain deps (sqlc) and start Postgres
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
	docker compose up -d db
	@echo "waiting for postgres..." && sleep 8
	$(MAKE) migrate

db: ## Start Postgres
	docker compose up -d db

stop: ## Stop Postgres
	docker compose down

migrate: ## Apply migrations and exit
	cd api && go run ./cmd/api --migrate-only

api: ## Run the Go API (migrates on boot)
	cd api && go run ./cmd/api

dev: ## Run API and Next together
	@echo "API on :8080, Next on :3000"
	@(cd api && go run ./cmd/api) & \
	trap 'kill 0' EXIT INT TERM; \
	bun dev

codegen: ## Regenerate Go types from SQL
	cd api && sqlc generate

openapi: ## Regenerate openapi.json from the Go routes
	cd api && go run ./cmd/api --print-openapi > ../openapi.json
	@echo "openapi.json updated"

orval: ## Regenerate the typed TypeScript client
	bunx orval --config orval.config.ts

test: ## Run Go tests (needs Postgres for the RLS suite)
	cd api && go test ./...

smoke: ## Run browser smoke tests (needs the full stack running)
	bunx playwright test

lint: ## Vet, gofmt check and typecheck
	cd api && gofmt -l ./cmd ./internal | (! grep .) && go vet ./...
	bun typecheck

logs: ## Tail the API log
	tail -f /tmp/fold-api.log

# Mints signed JWTs from a local JWKS, so the API can be driven without Better Auth in
# the loop. Build-tagged, so it never reaches the shipped binary.
#   make devjwt DEV_WORKSPACES='<workspaceUuid>:<userUuid>,...'
DEV_WORKSPACES ?=
devjwt:
	cd api && DEV_WORKSPACES='$(DEV_WORKSPACES)' go run -tags devtool ./cmd/devjwt