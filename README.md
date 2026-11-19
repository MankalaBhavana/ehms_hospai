# EHMS - Enterprise Hospital Management System

> **Latest Updates (2026-11-11):** See [`UPDATED_FILES_README.md`](UPDATED_FILES_README.md) for the complete categorized list of all 53 updated files, bug fixes, and verification status. See also [`CHANGES_2026-11-11.md`](CHANGES_2026-11-11.md) and [`FIXES_AND_TODO.md`](FIXES_AND_TODO.md).

| Folder | What it is |
|---|---|
| `backend/backend` | Flask API (patients, OP/ER/IP, beds, billing, lab, radiology, pharmacy, insurance, HR, reports). One process, PostgreSQL. |
| `backend/hr-api` | Separate HR service (optional; own database and migrations). |
| `frontend` | React app + the **production web server** (`server/prod.mjs`): static files, shared live-data sync, API proxy. |
| `ocr-frontend` | Embedded Keppler OCR screens, served at `/keppler-ocr`. |
| `ocr-backend` | OCR / document-AI service (needs model servers; the screens fall back to built-in sample answers without it). |
| `deploy` | Dockerfiles, `docker-compose.yml`, `.env.example`. |

```
browser ──https──> web (Node, :8443) ──/hms-api──> backend (gunicorn, :8010) ──> PostgreSQL
                     │  static app, /sync-api (shared live data), /keppler-ocr
```

## Deploy (Docker)

```bash
cp deploy/.env.example deploy/.env        # fill in every value
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Put TLS in front of the `web` service (reverse proxy, load balancer or a Cloudflare tunnel). Only `web` is
published; the database and backend are private to the compose network.

First sign-in: user `admin`, the password you set in `INITIAL_ADMIN_PASSWORD`. Change it immediately, then
create doctors and staff in Administration.

### What production mode enforces
* `APP_ENV=production` makes the backend **refuse to start** without `SESSION_PEPPER` (16+ chars),
  `SESSION_COOKIE_SECURE=true` and `DATABASE_URL`.
* There is no built-in admin password: the first administrator is created only if `INITIAL_ADMIN_PASSWORD` is set.
* Timestamps are stored and served in UTC and shown in IST by the screens; the database session is pinned to UTC.
* The web server sends no-cache for `index.html` and immutable caching for hashed assets, so a release is picked
  up by open tabs (and the app reloads itself if an old tab asks for a replaced file).

## Run without Docker

```bash
# backend (Python 3.12)
cd backend/backend && pip install -r requirements.txt
APP_ENV=production DATABASE_URL=postgresql://... SESSION_PEPPER=... SESSION_COOKIE_SECURE=true \
  INITIAL_ADMIN_PASSWORD=... TRUST_PROXY=true gunicorn --preload -b 0.0.0.0:8010 -w 3 --threads 8 app:app

# web
cd frontend && npm ci && npm run build
cd ../ocr-frontend && npm ci && npm run build            # optional
cd ../frontend && PUBLIC_APP_URL=https://your.host TRUST_PROXY=true npm start
```

Local development: `cd frontend && npm run dev` (Vite, proxies `/hms-api` to the backend on :8010).
Windows quick start with a public test link: `powershell -ExecutionPolicy Bypass -File .\start-team-test.ps1`.

## Configuration

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | PostgreSQL connection string |
| `SESSION_PEPPER` | backend | secret mixed into session hashes (required in production) |
| `SESSION_COOKIE_SECURE` | backend | `true` behind HTTPS |
| `INITIAL_ADMIN_PASSWORD` | backend | creates the first `admin` account |
| `PG_POOL_MIN` / `PG_POOL_MAX` | backend | per-worker DB pool; keep `workers x PG_POOL_MAX` under PostgreSQL `max_connections` |
| `TRUST_PROXY` | backend, web | trust `X-Forwarded-*` from the proxy in front |
| `BACKEND_URL` | web | where `/hms-api` is proxied (default `http://127.0.0.1:8010`) |
| `PUBLIC_APP_URL` | web | public URL printed into patient-card QR codes |
| `DATA_DIR` | web | where the shared live data is stored (a volume in Docker) |

## Health and operations
* Liveness: `GET /healthz` (web), `GET /hms-api/api/health` (backend).
* Readiness: `GET /hms-api/api/ready` checks the database (and Redis if configured); 503 when degraded.
* Tests: `python -m pytest backend/backend/tests` (every blueprint registered, naming), `cd frontend && npm run typecheck`.
* Backups: `pg_dump` the database **and** back up the `webdata` volume (`sync-kv.json`, see below).

## Known limitations (read before go-live)
See `FIXES_AND_TODO.md` for the full list. The important ones:
* **Shared live data** (OP queue, doctor workspace, lab, radiology, pharmacy, ER, beds, billing screens) still
  lives in each browser's storage and is replicated between users by `server/sync` into one JSON file
  (`DATA_DIR/sync-kv.json`). It is session-protected and merge-safe, but it is **not a database**: migrate those
  stores into PostgreSQL before treating this as a system of record. Back the file up with the database.
* The embedded OCR backend (`ocr-backend`) is not part of the compose stack; without it the OCR screens show
  sample answers only.
* `CELERY_TASK_ALWAYS_EAGER=true` runs background jobs inside the request; add a worker for long imports.
* `docker compose` files were written but could not be exercised in the build environment; run
  `docker compose config` and a trial deploy on a staging host first.
