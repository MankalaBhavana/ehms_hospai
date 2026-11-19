# Hospital backend (Flask) -- run with gunicorn.
# Build from the repository root:  docker build -f deploy/backend.Dockerfile -t ehms-backend .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libpq/opencv runtime libraries used by psycopg2 / opencv-headless
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/backend/ ./

RUN useradd --system --uid 10001 --home /app ehms && chown -R ehms /app
USER ehms

EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8010/api/health || exit 1

# --preload: the schema/bootstrap in app.py runs once in the master, not once per worker.
# Pool sizing: each worker holds its own DB pool (PG_POOL_MAX), so keep workers x PG_POOL_MAX
# below PostgreSQL's max_connections.
CMD ["gunicorn", "--preload", "--bind", "0.0.0.0:8010", \
     "--workers", "3", "--threads", "8", "--timeout", "300", \
     "--access-logfile", "-", "app:app"]
