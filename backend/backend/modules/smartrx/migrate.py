"""Forward-only SQL migrations for the ``smartrx`` schema.

    python -m modules.smartrx.migrate          (run from backend/backend)

Each ``migrations/NNN_name.sql`` runs once, in its own transaction, and is
recorded with a checksum in ``smartrx.schema_migrations``. A file edited after
it was applied is refused: add a new migration instead.
"""
import hashlib
import logging

from .config import MIGRATIONS_DIR

logger = logging.getLogger(__name__)
_LOCK_KEY = 74219001


def _checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run(conn) -> list:
    """Apply pending migrations on an open psycopg2 connection; return versions applied."""
    cur = conn.cursor()
    cur.execute("SELECT pg_advisory_lock(%s)", (_LOCK_KEY,))
    applied_now = []
    try:
        cur.execute("CREATE SCHEMA IF NOT EXISTS smartrx")
        cur.execute(
            """CREATE TABLE IF NOT EXISTS smartrx.schema_migrations (
                   version TEXT PRIMARY KEY,
                   checksum TEXT NOT NULL,
                   applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"""
        )
        conn.commit()
        cur.execute("SELECT version, checksum FROM smartrx.schema_migrations")
        done = dict(cur.fetchall())
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = path.stem
            sql = path.read_text(encoding="utf-8")
            digest = _checksum(sql)
            if version in done:
                if done[version] != digest:
                    raise RuntimeError(
                        f"Migration {version} was modified after being applied; add a new migration instead."
                    )
                continue
            try:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO smartrx.schema_migrations (version, checksum) VALUES (%s, %s)",
                    (version, digest),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            applied_now.append(version)
            logger.info("smartrx migration applied: %s", version)
    finally:
        try:
            cur.execute("SELECT pg_advisory_unlock(%s)", (_LOCK_KEY,))
            conn.commit()
        except Exception:
            conn.rollback()
    return applied_now


def main():
    import psycopg2
    from utils.database import DATABASE_URL, _normalize_database_url

    logging.basicConfig(level=logging.INFO)
    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    try:
        applied = run(conn)
    finally:
        conn.close()
    print("Applied:", ", ".join(applied) if applied else "nothing (up to date)")


if __name__ == "__main__":
    main()
