TAG ?= latest
WEB_PORT ?= 8080
TRIVY_CONTAINER_IMAGE ?= docker.io/aquasec/trivy:0.57.1
CHECKOV_BIN ?= backend/.venv/bin/checkov

export TAG
export WEB_PORT
export TRIVY_CONTAINER_IMAGE

.PHONY: docker-dev-up docker-dev-down docker-dev-logs docker-prod-up docker-prod-down docker-prod-build docker-prod-push docker-prod-release security-audit security-audit-backend security-audit-frontend security-audit-images security-audit-iac-local security-audit-trivy-config-local security-audit-local

docker-dev-up:
	docker compose -f docker-compose.dev.yml up -d --build

docker-dev-down:
	docker compose -f docker-compose.dev.yml down

docker-dev-logs:
	docker compose -f docker-compose.dev.yml logs -f

docker-prod-build:
	docker compose -f docker-compose.prod.yml build backend web

docker-prod-up:
	docker compose -f docker-compose.prod.yml up -d

docker-prod-down:
	docker compose -f docker-compose.prod.yml down

docker-prod-push:
	docker compose -f docker-compose.prod.yml push backend web

docker-prod-release: docker-prod-build docker-prod-push

security-audit: security-audit-backend security-audit-frontend

security-audit-backend:
	docker run --rm -v "$$(pwd)":/src -w /src python:3.12-slim sh -lc "pip install --no-cache-dir pip-audit >/dev/null && pip-audit -r backend/requirements.txt --strict"

security-audit-frontend:
	docker run --rm -v "$$(pwd)":/src -w /src/frontend node:20-alpine sh -lc "npm ci --ignore-scripts && npm audit --omit=dev --audit-level=high"

security-audit-images:
	trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 beeetfarmer/popinn-backend:${TAG}
	trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 beeetfarmer/popinn-web:${TAG}

security-audit-iac-local:
	$(CHECKOV_BIN) -f docker-compose.dev.yml -f docker-compose.prod.yml --quiet
	$(CHECKOV_BIN) -f backend/Dockerfile -f frontend/Dockerfile --quiet

security-audit-trivy-config-local:
	podman run --rm -v "$$(pwd)":/work:ro,Z -w /work $(TRIVY_CONTAINER_IMAGE) config --severity HIGH,CRITICAL --exit-code 1 .

security-audit-local: security-audit-iac-local security-audit-trivy-config-local
