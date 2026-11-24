"""Build the page-level text index of every guideline registered in Source_Log.csv.

    cd backend/backend
    python smartrx_pipeline/step4_index_guidelines.py                 # text-layer extraction (fast, ~30 s for the whole library)
    python smartrx_pipeline/step4_index_guidelines.py --ocr           # also OCR pages that have no text layer (slow, optional)
    python smartrx_pipeline/step4_index_guidelines.py --only SRC_126  # one document
    python smartrx_pipeline/step4_index_guidelines.py --force         # re-index even if the file is unchanged

What it does
  * PDFs      one passage per page (PyMuPDF text layer); pages without text are recorded as 'none', or OCR'd with --ocr
  * HTML      one passage per file
  * LactMed   one passage per drug record, read straight from the .tar.gz (nothing is extracted to disk)
  * Integrity the file's SHA-256 is compared with Source_Log.csv; a mismatch is recorded and reported
  * Incremental: a document whose file hash and extractor version are unchanged is skipped

OCR needs an optional engine:  pip install rapidocr-onnxruntime   (set SMARTRX_OCR_LIBS to a folder if installed with --target).
OCR text is stored with method 'ocr' and can never be the basis of a *verified* citation (see modules/smartrx/quotes.py).
"""
import argparse
import csv
import hashlib
import io
import os
import sys
import tarfile
import time
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import psycopg2  # noqa: E402
from psycopg2.extras import execute_values  # noqa: E402

from modules.smartrx.config import KNOWLEDGE_ROOT, SOURCE_LOG  # noqa: E402

EXTRACTOR_VERSION = "1"
MIN_TEXT_CHARS = 40          # fewer characters than this on a PDF page = "no text layer"
OCR_DPI = 200


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def clean(text: str) -> str:
    return (text or "").replace("\x00", "").strip()


def load_register(source_log: Path):
    with open(source_log, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f) if r.get("source_id")]


def locate_files(root: Path, names: set):
    found = {}
    for dp, _, fn in os.walk(root):
        for f in fn:
            if f in names and f not in found:
                found[f] = Path(dp) / f
    return found


# ---------------------------------------------------------------------------------------------- extractors

def extract_pdf(path: Path, ocr_engine=None):
    """Return [(page_label, text, method, ocr_confidence)]."""
    import fitz
    out = []
    with fitz.open(path) as doc:
        for i, page in enumerate(doc, start=1):
            text = clean(page.get_text())
            if len(text) >= MIN_TEXT_CHARS:
                out.append((str(i), text, "text", None))
            elif ocr_engine is not None:
                ocr_text, conf = ocr_engine(page)
                out.append((str(i), ocr_text, "ocr" if len(ocr_text) >= MIN_TEXT_CHARS else "none", conf))
            else:
                out.append((str(i), text, "none", None))
    return out


def extract_html(path: Path):
    from lxml import html
    tree = html.fromstring(path.read_bytes())
    for bad in tree.xpath("//script|//style|//noscript"):
        bad.getparent().remove(bad)
    text = " ".join(tree.text_content().split())
    return [("1", text, "html", None)]


def extract_lactmed(tar_path: Path):
    """One passage per drug record. Parsed in memory from the archive; entities and network access disabled."""
    from lxml import etree
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, recover=True)
    out = []
    with tarfile.open(tar_path, "r:gz") as tar:
        for member in tar:
            if not (member.isfile() and member.name.endswith(".nxml")):
                continue
            data = tar.extractfile(member).read()
            root = etree.parse(io.BytesIO(data), parser).getroot()
            if root is None:
                continue
            title = " ".join("".join(root.xpath("(//article-title)[1]//text()")).split())
            body = " ".join(" ".join(root.itertext()).split())
            label = Path(member.name).stem
            out.append((label, f"{title}. {body}" if title else body, "nxml", None))
    return out


def make_ocr_engine(log=print):
    """Return fn(fitz_page) -> (text, mean_confidence), or None when no OCR engine is installed."""
    libs = os.getenv("SMARTRX_OCR_LIBS")
    if libs and libs not in sys.path:
        sys.path.insert(0, libs)
    try:
        import numpy as np
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        log("OCR engine not installed (pip install rapidocr-onnxruntime); pages without a text layer stay unindexed.")
        return None
    engine = RapidOCR()

    def run(page):
        pix = page.get_pixmap(dpi=OCR_DPI)
        img = np.array(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
        result, _ = engine(img)
        if not result:
            return "", None
        # reading order: top-to-bottom, then left-to-right, grouping boxes whose tops are within half a line
        lines = sorted(((box[0][1], box[0][0], txt, float(conf)) for box, txt, conf in result), key=lambda r: (round(r[0] / 18), r[1]))
        return clean("\n".join(r[2] for r in lines)), round(sum(r[3] for r in lines) / len(lines), 3)

    return run


# ---------------------------------------------------------------------------------------------- storage

def store_document(cur, source_id, file_sha, hash_ok, pages, status="ok", error=None):
    text_pages = sum(1 for p in pages if p[2] in ("text", "html", "nxml"))
    ocr_pages = sum(1 for p in pages if p[2] == "ocr")
    empty = sum(1 for p in pages if p[2] == "none")
    cur.execute("DELETE FROM smartrx.guideline_passage WHERE source_id = %s", (source_id,))
    if pages:
        execute_values(cur, """INSERT INTO smartrx.guideline_passage (source_id, page, method, text, char_count, text_sha256, ocr_confidence)
                               VALUES %s""",
                       [(source_id, label, method, text, len(text), hashlib.sha256(text.encode("utf-8")).hexdigest(), conf)
                        for label, text, method, conf in pages], page_size=500)
    cur.execute("""INSERT INTO smartrx.guideline_document (source_id, file_sha256, hash_matches_log, pages, text_pages, ocr_pages,
                       empty_pages, status, error, extractor_version, indexed_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                   ON CONFLICT (source_id) DO UPDATE SET file_sha256 = EXCLUDED.file_sha256, hash_matches_log = EXCLUDED.hash_matches_log,
                       pages = EXCLUDED.pages, text_pages = EXCLUDED.text_pages, ocr_pages = EXCLUDED.ocr_pages,
                       empty_pages = EXCLUDED.empty_pages, status = EXCLUDED.status, error = EXCLUDED.error,
                       extractor_version = EXCLUDED.extractor_version, indexed_at = NOW()""",
                (source_id, file_sha, hash_ok, len(pages), text_pages, ocr_pages, empty,
                 status if empty == 0 or status == "error" else "partial", error, EXTRACTOR_VERSION))
    return text_pages, ocr_pages, empty


def index_documents(conn, root: Path, source_log: Path, only=None, force=False, ocr=False, ocr_engine=None, log=print):
    """Index every registered PDF/HTML/LactMed archive found under `root`. Returns a summary dict."""
    register = load_register(source_log)
    wanted = {r["filename"] for r in register if r["filename"].lower().endswith((".pdf", ".html", ".tar.gz"))}
    files = locate_files(root, wanted)
    if ocr and ocr_engine is None:
        ocr_engine = make_ocr_engine(log)
    summary = {"indexed": 0, "skipped": 0, "errors": [], "hash_mismatch": [], "missing": [], "pending_ocr": []}
    cur = conn.cursor()
    for r in register:
        sid, fname = r["source_id"], r["filename"]
        low = fname.lower()
        if not low.endswith((".pdf", ".html", ".tar.gz")) or (only and sid not in only):
            continue
        path = files.get(fname)
        if not path:
            summary["missing"].append(sid)
            continue
        file_sha = sha256_file(path)
        hash_ok = (file_sha.lower() == (r.get("sha256") or "").strip().lower()) if (r.get("sha256") or "").strip() not in ("", "N/A") else None
        if hash_ok is False:
            summary["hash_mismatch"].append(sid)
        cur.execute("SELECT file_sha256, extractor_version, empty_pages FROM smartrx.guideline_document WHERE source_id = %s", (sid,))
        prev = cur.fetchone()
        if prev and not force and prev[0] == file_sha and prev[1] == EXTRACTOR_VERSION and not (ocr and prev[2] and ocr_engine):
            summary["skipped"] += 1
            continue
        try:
            if low.endswith(".pdf"):
                pages = extract_pdf(path, ocr_engine if ocr else None)
            elif low.endswith(".html"):
                pages = extract_html(path)
            else:
                pages = extract_lactmed(path)
            text_pages, ocr_pages, empty = store_document(cur, sid, file_sha, hash_ok, pages)
            conn.commit()
            summary["indexed"] += 1
            if empty:
                summary["pending_ocr"].append((sid, empty))
            log(f"  {sid:8} {len(pages):>5} pages  text={text_pages} ocr={ocr_pages} empty={empty}  {fname[:50]}")
        except Exception as exc:  # one bad file must not stop the library
            conn.rollback()
            cur.execute("""INSERT INTO smartrx.guideline_document (source_id, file_sha256, hash_matches_log, pages, status, error, extractor_version)
                           VALUES (%s,%s,%s,0,'error',%s,%s)
                           ON CONFLICT (source_id) DO UPDATE SET status='error', error=EXCLUDED.error, indexed_at=NOW()""",
                        (sid, file_sha, hash_ok, str(exc)[:500], EXTRACTOR_VERSION))
            conn.commit()
            summary["errors"].append((sid, str(exc)[:120]))
            log(f"  {sid:8} ERROR {str(exc)[:100]}")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ocr", action="store_true", help="OCR pages that have no text layer")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*", help="source ids, e.g. SRC_126")
    args = ap.parse_args()

    from utils.database import DATABASE_URL, _normalize_database_url
    from modules.smartrx import migrate

    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    migrate.run(conn)
    t0 = time.time()
    print(f"Indexing guidelines from {KNOWLEDGE_ROOT}")
    s = index_documents(conn, KNOWLEDGE_ROOT, SOURCE_LOG, only=set(args.only) if args.only else None, force=args.force, ocr=args.ocr)
    cur = conn.cursor()
    cur.execute("""SELECT COUNT(*), COALESCE(SUM(pages),0), COALESCE(SUM(text_pages),0), COALESCE(SUM(ocr_pages),0), COALESCE(SUM(empty_pages),0)
                   FROM smartrx.guideline_document WHERE status <> 'error'""")
    docs, pages, text_pages, ocr_pages, empty = cur.fetchone()
    print(f"\nIndexed {s['indexed']} document(s), skipped {s['skipped']} unchanged, in {time.time() - t0:.0f}s")
    print(f"Index now holds {docs} documents, {pages:,} pages: text={text_pages:,} ocr={ocr_pages:,} no-text={empty:,}")
    if s["missing"]:
        print(f"WARNING {len(s['missing'])} registered file(s) not found on disk: {', '.join(s['missing'][:10])}")
    if s["hash_mismatch"]:
        print(f"WARNING {len(s['hash_mismatch'])} file(s) differ from the hash in Source_Log.csv: {', '.join(s['hash_mismatch'])}")
    if s["errors"]:
        print(f"ERRORS {len(s['errors'])}: " + "; ".join(f"{a}: {b}" for a, b in s["errors"]))
    conn.close()
    sys.exit(1 if s["errors"] else 0)


if __name__ == "__main__":
    main()
