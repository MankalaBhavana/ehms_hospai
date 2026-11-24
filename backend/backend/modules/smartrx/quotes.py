"""Mechanical verification that a cited quote really appears on the cited guideline page.

A reviewer copies a passage into a rule and cites (source_id, page, quote). This module checks the quote against the
page index so a typo, a wrong page or a paraphrase cannot pass as "verified". It checks wording only; whether the
passage supports the rule is the reviewer's judgement.
"""
import re
import unicodedata

MIN_QUOTE_CHARS = 25
# Text extracted by OCR can contain misread digits ("0.5" -> "6.5"), so it can never be the basis of a verified citation.
VERIFIABLE_METHODS = ("text", "html", "nxml")

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "−": "-",
                         "‐": "-", "‑": "-", "­": "", " ": " "})
_LINEBREAK_HYPHEN = re.compile(r"(?<=[a-z])-\s*\n\s*(?=[a-z])")
_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Case-fold and tidy typography so formatting differences do not matter but digits and units stay exact."""
    t = unicodedata.normalize("NFKC", text or "").translate(_QUOTES).casefold()
    t = _LINEBREAK_HYPHEN.sub("", t)            # "anti-\nbiotic" -> "antibiotic"
    return _SPACES.sub(" ", t).strip()


def quote_in_text(quote: str, page_text: str) -> bool:
    q = normalize(quote)
    return len(q) >= MIN_QUOTE_CHARS and q in normalize(page_text)


def verify_quote(cur, source_id, page, quote):
    """Return (ok, reason). `reason` is a reviewer-friendly explanation when not ok."""
    if not quote or len(normalize(quote)) < MIN_QUOTE_CHARS:
        return False, f"quote is too short (need at least {MIN_QUOTE_CHARS} characters of the original wording)"
    cur.execute("SELECT hash_matches_log FROM smartrx.guideline_document WHERE source_id = %s", (source_id,))
    doc = cur.fetchone()
    if not doc:
        return False, f"{source_id} has not been indexed (run smartrx_pipeline/step4_index_guidelines.py)"
    if doc[0] is False:
        return False, (f"the file indexed for {source_id} differs from the hash registered in Source_Log.csv, so it cannot be relied on; "
                       "restore the registered file or re-register the new one after review")
    cur.execute("SELECT method, text FROM smartrx.guideline_passage WHERE source_id = %s AND page = %s", (source_id, str(page)))
    row = cur.fetchone()
    if not row:
        return False, f"{source_id} has no page '{page}' in the index"
    method, text = row
    if method not in VERIFIABLE_METHODS:
        return False, (f"page {page} of {source_id} is OCR/empty text ({method}); OCR can misread digits, so it cannot be the basis "
                       "of a verified citation. Use a text-layer source or have the page text corrected by a person.")
    if quote_in_text(quote, text):
        return True, "ok"
    cur.execute("SELECT page, text FROM smartrx.guideline_passage WHERE source_id = %s AND method = ANY(%s)",
                (source_id, list(VERIFIABLE_METHODS)))
    elsewhere = [p for p, t in cur.fetchall() if quote_in_text(quote, t)]
    hint = f" The wording appears on page(s) {', '.join(elsewhere[:5])}." if elsewhere else ""
    return False, f"quote not found on page {page} of {source_id}.{hint}"
