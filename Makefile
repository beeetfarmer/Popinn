DEV_ENV_FILE ?= .env
PROD_ENV_FILE ?= .env
TRIVY_CONTAINER_IMAGE ?= docker.io/aquasec/trivy:0.72.0
CHECKOV_BIN ?= backend/.venv/bin/checkov

# TAG and WEB_PORT come from the env file, which compose reads via --env-file.
# They are only pushed into the environment when overridden on the command line
# (make TAG=x ...), because an exported shell variable silently beats the env
# file during compose interpolation -- which previously made WEB_PORT=8046 in
# .env come up on 8080 instead.
TAG ?= $(shell sed -n 's/^TAG=//p' $(PROD_ENV_FILE) 2>/dev/null | tail -1)
TAG := $(or $(strip $(TAG)),latest)
WEB_PORT ?= $(shell sed -n 's/^WEB_PORT=//p' $(PROD_ENV_FILE) 2>/dev/null | tail -1)
WEB_PORT := $(or $(strip $(WEB_PORT)),8080)

ifeq ($(origin TAG), command line)
export TAG
endif
ifeq ($(origin WEB_PORT), command line)
export WEB_PORT
endif

export TRIVY_CONTAINER_IMAGE

.PHONY: docker-dev-up docker-dev-down docker-dev-logs docker-prod-up docker-prod-down docker-prod-build docker-prod-push docker-prod-release podman-dev-up podman-dev-down podman-dev-logs podman-prod-build podman-prod-up podman-prod-down podman-prod-push security-audit security-audit-backend security-audit-frontend security-audit-images security-audit-iac-local security-audit-trivy-config-local security-audit-local

docker-dev-up:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) docker compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml up -d --build

docker-dev-down:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) docker compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml down

docker-dev-logs:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) docker compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml logs -f

docker-prod-build:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) docker compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml build backend web

docker-prod-up:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) docker compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml up -d

docker-prod-down:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) docker compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml down

docker-prod-push:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) docker compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml push backend web

docker-prod-release: docker-prod-build docker-prod-push

podman-dev-up:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) podman compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml up -d --build

podman-dev-down:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) podman compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml down

podman-dev-logs:
	POPINN_ENV_FILE=$(DEV_ENV_FILE) podman compose --env-file $(DEV_ENV_FILE) -f docker-compose.dev.yml logs -f

podman-prod-build:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) podman compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml build backend web

podman-prod-up:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) podman compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml up -d

podman-prod-down:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) podman compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml down

podman-prod-push:
	POPINN_ENV_FILE=$(PROD_ENV_FILE) podman compose --env-file $(PROD_ENV_FILE) -f docker-compose.prod.yml push backend web

security-audit: security-audit-backend security-audit-frontend

security-audit-backend:
	docker run --rm -v "$$(pwd)":/src -w /src python:3.12-slim sh -lc "pip install --no-cache-dir pip-audit >/dev/null && pip-audit -r backend/requirements.txt --strict"

security-audit-frontend:
	docker run --rm -v "$$(pwd)":/src -w /src/frontend node:22-alpine sh -lc "npm ci --ignore-scripts && npm audit --omit=dev --audit-level=high"

security-audit-images:
	trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 beeetfarmer/popinn-backend:$(TAG)
	trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 beeetfarmer/popinn-web:$(TAG)

security-audit-iac-local:
	$(CHECKOV_BIN) -f docker-compose.dev.yml -f docker-compose.prod.yml --quiet
	$(CHECKOV_BIN) -f backend/Dockerfile -f frontend/Dockerfile --quiet

security-audit-trivy-config-local:
	podman run --rm -v "$$(pwd)":/work:ro,Z -w /work $(TRIVY_CONTAINER_IMAGE) config --severity HIGH,CRITICAL --exit-code 1 .

security-audit-local: security-audit-iac-local security-audit-trivy-config-local
