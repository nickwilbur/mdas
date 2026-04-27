.PHONY: up down seed migrate test ci-guard logs

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
