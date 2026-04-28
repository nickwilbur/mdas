.PHONY: up down seed migrate test ci-guard logs sf-login sf-fieldmap sf-validate

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
