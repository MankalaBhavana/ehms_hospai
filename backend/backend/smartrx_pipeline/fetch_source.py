"""Download guideline documents and register them: file + SHA-256 + Source_Log.csv row + jurisdiction.

    cd backend/backend
    python smartrx_pipeline/fetch_source.py smartrx_data/source_manifest_2026-11_india.csv            # download + register
    python smartrx_pipeline/fetch_source.py smartrx_data/source_manifest_2026-11_india.csv --dry-run  # show what would happen
    python smartrx_pipeline/fetch_source.py --retry-failed                                            # retry register rows that failed on a transient error

Manifest columns: url, name, publisher, dest_dir (relative to the knowledge root), version, licence, jurisdiction (default India), notes.

Safeguards
  * only PDFs (checked by file signature, not by name or header): an HTML error page or login page is rejected and nothing is registered
  * size limit (default 150 MB), timeouts, a polite delay between requests, one retry
  * never bypasses a login, licence click-through or CAPTCHA: rows whose note says so are not retried
  * a URL or a file (by SHA-256) already in the register is skipped, so re-running is safe
  * downloaded files are data, never executed; each is saved under its own descriptive name with the download date
"""
import argparse
import csv
import hashlib
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.smartrx.config import DATA_DIR, KNOWLEDGE_ROOT, SOURCE_LOG  # noqa: E402

USER_AGENT = "Mozilla/5.0 (compatible; HospAI-KnowledgeFetcher/1.0)"
MAX_BYTES = 150 * 1024 * 1024
TIMEOUT = 60
NOT_RETRYABLE = re.compile(r"login|licen[cs]e|captcha|registration|subscription|paywall|placeholder|interactive|URL only|over size", re.I)


class FetchError(Exception):
    pass


def slugify(text, limit=80):
    s = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return s[:limit].rstrip("_") or "document"


def encode_url(url):
    """Percent-encode spaces and other unsafe characters in the path, leaving existing escapes alone."""
    parts = urllib.parse.urlsplit(url.strip())
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, urllib.parse.quote(parts.path, safe="/%:@!$&'()*+,;=~-._"), parts.query, ""))


def download(url, dest: Path, max_bytes=MAX_BYTES, timeout=TIMEOUT, opener=urllib.request.urlopen):
    """Stream `url` to `dest`. Returns (size, sha256). Raises FetchError and leaves nothing behind on any problem."""
    req = urllib.request.Request(encode_url(url), headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"})
    part = dest.with_suffix(dest.suffix + ".part")
    h, size = hashlib.sha256(), 0
    try:
        with opener(req, timeout=timeout) as resp, open(part, "wb") as out:
            first = True
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                if first:
                    first = False
                    if not chunk.startswith(b"%PDF-"):
                        raise FetchError("the server did not return a PDF (HTML error, login or redirect page)")
                size += len(chunk)
                if size > max_bytes:
                    raise FetchError(f"larger than the {max_bytes // (1024 * 1024)} MB limit")
                h.update(chunk)
                out.write(chunk)
        if size == 0:
            raise FetchError("empty response")
        os.replace(part, dest)
        return size, h.hexdigest()
    except FetchError:
        raise
    except urllib.error.HTTPError as exc:
        raise FetchError(f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FetchError(f"connection problem: {getattr(exc, 'reason', exc)}") from exc
    finally:
        if part.exists():
            part.unlink()


# ------------------------------------------------------------------------------------------------- register io

def read_register(path: Path):
    raw = path.read_bytes()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    bom = raw.startswith(b"\xef\xbb\xbf")
    reader = csv.DictReader(raw.decode("utf-8-sig").splitlines())
    return list(reader), list(reader.fieldnames), nl, bom


def write_register(path: Path, rows, fields, nl, bom):
    tmp = path.with_suffix(".csv.tmp")
    with open(tmp, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator=nl)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def next_source_id(rows):
    nums = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"SRC_(\d+)", r["source_id"]))]
    return f"SRC_{max(nums, default=0) + 1:03d}"


def add_jurisdiction(source_id, jurisdiction, basis, data_dir: Path):
    path = data_dir / "source_jurisdiction.csv"
    rows = list(csv.DictReader(open(path, encoding="utf-8"))) if path.exists() else []
    if not any(r["source_id"] == source_id for r in rows):
        rows.append({"source_id": source_id, "jurisdiction": jurisdiction, "basis": basis})
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["source_id", "jurisdiction", "basis"], lineterminator="\n")
            w.writeheader()
            w.writerows(rows)


# ------------------------------------------------------------------------------------------------- operations

def fetch_manifest(manifest, root: Path, source_log: Path, data_dir: Path, dry_run=False, delay=1.0, today=None, log=print, opener=urllib.request.urlopen):
    today = today or date.today().isoformat()
    rows, fields, nl, bom = read_register(source_log)
    known_urls = {r["url"].strip() for r in rows if r["filename"] not in ("", "N/A")}
    known_hashes = {r["sha256"]: r["source_id"] for r in rows if r["sha256"] not in ("", "N/A")}
    results = []
    entries = list(csv.DictReader(open(manifest, encoding="utf-8-sig", newline="")))
    for i, e in enumerate(entries):
        url, name = e["url"].strip(), e["name"].strip()
        if url in known_urls:
            results.append((name, "skipped", "URL already in the register"))
            continue
        folder = root / e["dest_dir"].strip()
        filename = f"{slugify(name)}_downloaded-{today}.pdf"
        if dry_run:
            results.append((name, "would fetch", f"{url} -> {e['dest_dir']}/{filename}"))
            continue
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / filename
        if i and delay:
            time.sleep(delay)
        try:
            try:
                size, sha = download(url, dest, opener=opener)
            except FetchError as first:
                if "HTTP 4" in str(first) or "PDF" in str(first):
                    raise
                time.sleep(2)
                size, sha = download(url, dest, opener=opener)           # one retry for transient errors
        except FetchError as exc:
            results.append((name, "FAILED", str(exc)))
            continue
        if sha in known_hashes:
            dest.unlink()
            results.append((name, "skipped", f"identical content to {known_hashes[sha]}"))
            continue
        sid = next_source_id(rows)
        publisher = e.get("publisher", "").strip()
        rows.append({"source_id": sid, "source_name": name, "publisher": publisher, "url": url, "version_or_date": e.get("version", "").strip() or "N/A",
                     "downloaded_on": today, "filename": filename, "file_size": str(size), "row_count": "N/A", "sha256": sha,
                     "licence": e.get("licence", "").strip() or "Unknown", "licence_verified": "no",
                     "attribution": f"{name}, {publisher} ({url})", "review_status": "unreviewed",
                     "notes": (e.get("notes", "").strip() + " " if e.get("notes") else "") + f"Downloaded and validated (PDF signature, SHA-256) in {e['dest_dir']}."})
        write_register(source_log, rows, fields, nl, bom)                  # saved after every file: an interruption loses nothing
        add_jurisdiction(sid, (e.get("jurisdiction") or "India").strip(), "fetched from the publisher's official site", data_dir)
        known_urls.add(url)
        known_hashes[sha] = sid
        results.append((name, "ok", f"{sid}  {size // 1024} KB"))
        log(f"  {sid}  {size // 1024:>7} KB  {name}")
    return results


def retry_failed(root: Path, source_log: Path, delay=1.0, today=None, log=print, opener=urllib.request.urlopen):
    """Retry register rows that failed on a transient error and have a direct .pdf URL. Never retries login/CAPTCHA rows."""
    today = today or date.today().isoformat()
    rows, fields, nl, bom = read_register(source_log)
    results = []
    for r in rows:
        if r["filename"] not in ("", "N/A") or not r["notes"].startswith("Failed") or NOT_RETRYABLE.search(r["notes"]):
            continue
        if not urllib.parse.urlsplit(r["url"]).path.lower().endswith(".pdf"):
            continue
        folder = root / "01_Source_Library" / "Retried"
        folder.mkdir(parents=True, exist_ok=True)
        filename = f"{slugify(r['source_name'])}_downloaded-{today}.pdf"
        time.sleep(delay)
        try:
            size, sha = download(r["url"], folder / filename, opener=opener)
        except FetchError as exc:
            results.append((r["source_id"], "still failing", str(exc)))
            continue
        r.update({"filename": filename, "file_size": str(size), "sha256": sha, "downloaded_on": today, "review_status": "unreviewed",
                  "notes": f"Retried and downloaded on {today} (previously: {r['notes'][:80]}). Stored in 01_Source_Library/Retried."})
        write_register(source_log, rows, fields, nl, bom)
        results.append((r["source_id"], "ok", f"{size // 1024} KB"))
        log(f"  {r['source_id']}  {size // 1024:>7} KB  {r['source_name'][:60]}")
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retry-failed", action="store_true")
    ap.add_argument("--delay", type=float, default=1.0)
    args = ap.parse_args()
    if args.retry_failed:
        res = retry_failed(KNOWLEDGE_ROOT, SOURCE_LOG, delay=args.delay)
    elif args.manifest:
        res = fetch_manifest(Path(args.manifest), KNOWLEDGE_ROOT, SOURCE_LOG, DATA_DIR, dry_run=args.dry_run, delay=args.delay)
    else:
        ap.error("give a manifest, or --retry-failed")
    for name, status, detail in res:
        if status not in ("ok",):
            print(f"{status:12} {name[:60]}  {detail}")
    ok = sum(1 for r in res if r[1] == "ok")
    print(f"\n{ok} downloaded, {sum(1 for r in res if r[1] == 'skipped')} skipped, {sum(1 for r in res if r[1] in ('FAILED', 'still failing'))} failed")
    sys.exit(1 if any(r[1] in ("FAILED", "still failing") for r in res) else 0)


if __name__ == "__main__":
    main()
