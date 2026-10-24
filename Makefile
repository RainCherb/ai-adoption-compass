.DEFAULT_GOAL := help
VENV ?= .venv
BIN := $(VENV)/bin

.PHONY: help install web-install web test lint format typecheck openapi check run demo docker screenshots clean

help: ## Показать команды
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Создать окружение и установить бэкенд с dev-зависимостями
	python3 -m venv $(VENV)
	$(BIN)/pip install --upgrade pip
	$(BIN)/pip install -e ".[dev]"

web-install: ## Установить зависимости фронтенда
	cd web && npm ci

web: web-install ## Собрать веб-интерфейс в src/adoption_compass/static
	cd web && npm run build

test: ## Тесты бэкенда с проверкой покрытия
	$(BIN)/pytest

lint: ## Линтер и проверка форматирования
	$(BIN)/ruff check src tests scripts
	$(BIN)/ruff format --check src tests scripts

format: ## Автоформатирование
	$(BIN)/ruff format src tests scripts
	$(BIN)/ruff check --fix src tests scripts

typecheck: ## Строгая проверка типов
	$(BIN)/mypy

openapi: ## Обновить docs/openapi.json (контракт для фронтенда)
	$(BIN)/python scripts/export_openapi.py
	cd web && npm run gen:api

check: lint typecheck test ## Всё, что проверяет CI для бэкенда
	$(BIN)/python scripts/export_openapi.py --check
	cd web && npm run typecheck && npm run lint && npm run test

run: ## Запустить API и интерфейс на http://127.0.0.1:8000
	$(BIN)/compass serve

demo: ## Показать возможности в терминале
	$(BIN)/compass demo

docker: ## Собрать образ
	docker build -t ai-adoption-compass .

screenshots: ## Обновить скриншоты и терминальное демо в docs/assets
	$(BIN)/pip install -e ".[docs]"
	$(BIN)/python scripts/capture_screenshots.py
	$(BIN)/python scripts/render_cli_demo.py

clean: ## Удалить артефакты сборки
	rm -rf dist build .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage coverage.xml src/adoption_compass/static
