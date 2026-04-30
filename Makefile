.PHONY: up down seed migrate test ci-guard logs sf-login sf-fieldmap sf-validate glean-token

up:
	docker compose up -d --build

down:
	docker compose down

migrate:
	npm run migrate

seed:
	npm run seed

test:
	npm test

ci-guard:
	npm run ci:guard

logs:
	docker compose logs -f

# ----- Salesforce CLI dev tooling (read-only metadata operations) -----
# sf is a developer/CI tool only. It is NOT bundled into the Docker image.
# Runtime Salesforce calls go through OAuth + jsforce in the worker.

# Authenticate the local sf CLI against the production org. Idempotent —
# reuses any existing auth, opens a browser only when re-auth is needed.
sf-login:
	@if sf org display --target-org mdas-prod --json >/dev/null 2>&1; then \
	  echo "[sf-login] mdas-prod already authenticated:"; \
	  sf org display --target-org mdas-prod | head -10; \
	else \
	  sf org login web --alias mdas-prod; \
	fi

# Regenerate packages/adapters/read/salesforce/generated/field-map.ts
# from sf sobject describe. Idempotent; commit the diff for PR review.
sf-fieldmap:
	npm run sf:fieldmap

# Validate that every Salesforce field MDAS references actually exists in
# the prod org. Fails non-zero on drift. Suitable for CI.
sf-validate:
	npm run sf:validate

# Refresh GLEAN_MCP_TOKEN in .env from the access_token Windsurf
# negotiated with Glean's MCP OAuth flow. Glean tokens have ~1-week TTL;
# re-run when the in-app /api/glean/* routes start returning 401. The
# `unset` clears any stale value that might be lingering in the parent
# shell (which would otherwise shadow .env in docker compose).
glean-token:
	@unset GLEAN_MCP_TOKEN && node scripts/refresh-glean-token.mjs
	@echo "[glean-token] re-creating web + worker so they pick up the new token..."
	@unset GLEAN_MCP_TOKEN ADAPTER_TIMEOUT_MS_CEREBRO ADAPTER_TIMEOUT_MS_GAINSIGHT ADAPTER_TIMEOUT_MS_GLEAN_MCP CEREBRO_CONCURRENCY GAINSIGHT_CONCURRENCY GLEAN_CONCURRENCY GLEAN_ENRICH_LIMIT && docker compose up -d --force-recreate --no-deps web worker
	@sleep 4 && curl -sS http://localhost:3000/api/glean/health | head -c 400 && echo
