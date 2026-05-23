.PHONY: build up down logs restart shell clean

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100 kovcheg

restart: down up

shell:
	docker compose exec kovcheg bash

# Индексация материалов для ассистента
index:
	docker compose run --rm kovcheg python scripts/index_knowledge.py

# Открыть shell в контейнере с Python
manage:
	docker compose run --rm kovcheg python

clean:
	docker compose down -v --rmi all
