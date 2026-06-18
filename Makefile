# CS2 Tracker — common dev commands. Run `make` or `make help` for the list.
# (Backend targets run from ./backend; needs Go 1.26+. Frontend needs Node 20+.)

.DEFAULT_GOAL := help
.PHONY: help build test vet fmt lint-fmt tidy \
        run-api run-worker seed parsedemo steamcheck \
        frontend-install frontend-dev frontend-build frontend-typecheck \
        up down logs seed-docker

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

## --- Backend -------------------------------------------------------------
build: ## Build all backend binaries
	cd backend && go build ./...

test: ## Run backend tests
	cd backend && go test ./...

vet: ## go vet the backend
	cd backend && go vet ./...

fmt: ## Format backend code
	cd backend && gofmt -w .

lint-fmt: ## Fail if any backend file is unformatted
	cd backend && test -z "$$(gofmt -l .)" || (gofmt -l . && exit 1)

tidy: ## Tidy go.mod / go.sum
	cd backend && go mod tidy

run-api: ## Run the API server (uses .env / env)
	cd backend && go run ./cmd/api

run-worker: ## Run the parse worker
	cd backend && go run ./cmd/worker

seed: ## Seed synthetic demo data into Postgres
	cd backend && go run ./cmd/seed

parsedemo: ## Parse a local demo: make parsedemo DEMO=path/to.dem
	cd backend && go run ./cmd/parsedemo $(DEMO)

steamcheck: ## Verify the Steam API key live: make steamcheck [Q=vanity|id]
	cd backend && go run ./cmd/steamcheck $(Q)

## --- Frontend ------------------------------------------------------------
frontend-install: ## Install frontend dependencies
	cd frontend && npm install

frontend-dev: ## Run the Next.js dev server
	cd frontend && npm run dev

frontend-build: ## Production build of the frontend
	cd frontend && npm run build

frontend-typecheck: ## Type-check the frontend
	cd frontend && npm run typecheck

## --- Docker --------------------------------------------------------------
up: ## Start the full stack (requires a healthy Docker engine)
	docker compose up --build

down: ## Stop the stack and remove volumes
	docker compose down -v

logs: ## Follow all service logs
	docker compose logs -f

seed-docker: ## Seed demo data inside the running backend container
	docker compose run --rm backend seed
