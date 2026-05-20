.PHONY: up down seed migrate test ci-guard logs sf-login sf-fieldmap sf-validate glean-login glean-refresh glean-token

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

# One-time interactive Glean OAuth login. Opens a browser, runs PKCE +
# Dynamic Client Registration against Glean's MCP server, saves the
# refresh_token in .glean-oauth.json (gitignored) and the access_token
# in .env. After this, `make glean-token` (or `make glean-refresh`) can
# silently renew without re-authenticating.
glean-login:
	@unset GLEAN_MCP_TOKEN && node scripts/glean-login.mjs

# Silently renew GLEAN_MCP_TOKEN using the refresh_token saved by
# `make glean-login`. No browser, no editor required. Safe in
# cron/pre-job hooks. Fails fast with instructions if the refresh
# token is missing or rejected.
glean-refresh:
	@unset GLEAN_MCP_TOKEN && node scripts/glean-refresh.mjs

# Refresh GLEAN_MCP_TOKEN in .env. Tries sources in this order until
# one yields a non-expired access_token:
#   1. .glean-oauth.json refresh_token grant (set up by `make glean-login`)
#   2. Cursor's encrypted MCP token store
#   3. Windsurf's encrypted MCP token store
# Glean tokens have ~1-week TTL; re-run when /api/glean/health flips
# to 401. The `unset` clears any stale value lingering in the parent
# shell (which would otherwise shadow .env in docker compose).
#
# Force a specific source with GLEAN_TOKEN_SOURCE=in-repo|cursor|windsurf.
#
# This target supports both deployment modes:
#   - docker compose (web/worker as containers): recreate them so they
#     re-read .env.
#   - local ./restart.sh (web/worker as host processes): nothing to do
#     here, the user re-runs ./restart.sh themselves.
# We detect docker mode by checking if the mdas-web-1 container exists.
glean-token:
	@unset GLEAN_MCP_TOKEN && node scripts/refresh-glean-token.mjs
	@if docker ps -a --format '{{.Names}}' | grep -q '^mdas-web-1$$'; then \
		echo "[glean-token] re-creating web + worker so they pick up the new token..."; \
		unset GLEAN_MCP_TOKEN ADAPTER_TIMEOUT_MS_CEREBRO ADAPTER_TIMEOUT_MS_GAINSIGHT ADAPTER_TIMEOUT_MS_GLEAN_MCP CEREBRO_CONCURRENCY GAINSIGHT_CONCURRENCY GLEAN_CONCURRENCY GLEAN_ENRICH_LIMIT && docker compose up -d --force-recreate --no-deps web worker; \
		sleep 4 && curl -sS http://localhost:3000/api/glean/health | head -c 400 && echo; \
	else \
		echo "[glean-token] no docker web container running — run ./restart.sh to apply."; \
	fi
