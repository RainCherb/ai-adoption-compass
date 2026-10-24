# syntax=docker/dockerfile:1

# --- 1. Сборка веб-интерфейса -------------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# vite.config.ts собирает в ../src/adoption_compass/static
RUN mkdir -p /app/src/adoption_compass && npm run build

# --- 2. Рабочий образ ----------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COMPASS_DB=/data/compass.db
WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY --from=web /app/src/adoption_compass/static ./src/adoption_compass/static
RUN pip install .

RUN useradd --create-home --uid 10001 compass \
    && mkdir /data \
    && chown compass /data
USER 10001
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/api/health', timeout=3)"]

# Внутри контейнера слушаем все интерфейсы; наружу порт публикуется только на localhost (см. docker-compose.yml).
ENTRYPOINT ["python", "-m", "adoption_compass.container"]
CMD ["compass", "serve", "--host", "0.0.0.0", "--port", "8000"]
