TAG ?= latest
WEB_PORT ?= 8080

export TAG
export WEB_PORT

.PHONY: docker-dev-up docker-dev-down docker-dev-logs docker-prod-up docker-prod-down docker-prod-build docker-prod-push docker-prod-release security-audit security-audit-backend security-audit-frontend security-audit-images

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
