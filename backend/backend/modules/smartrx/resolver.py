"""Resolve a free-text prescribed medicine to catalogue brand / active moieties with a confidence."""
import difflib
import re
import threading
from dataclasses import dataclass, field, asdict
from typing import Optional

from .config import FUZZY_MIN_RATIO
from .knowledge import KnowledgeBase
from .textnorm import name_key, normalize_text, split_name_strength

_COLS = "id, brand_name, generic_name, moiety_identifiers, is_high_alert, nlem_level, route_hint, name_norm"
_heads_lock = threading.Lock()
_heads = {"version": None, "words": []}


@dataclass
class Resolution:
    input: str
    matched: bool = False
    method: str = "none"          # brand_exact | substance_name | brand_prefix | fuzzy | none
    confidence: float = 0.0
    ambiguous: bool = False
    interpreted_as: Optional[str] = None
    brand: Optional[str] = None
    generic: Optional[str] = None
    moieties: list = field(default_factory=list)
    is_high_alert: bool = False
    nlem_level: Optional[str] = None
    route_hint: Optional[str] = None
    strengths: list = field(default_factory=list)
    candidates: list = field(default_factory=list)

    def as_dict(self):
        return asdict(self)


def _row_to_candidate(r):
    return {"id": r[0], "brand": r[1], "generic": r[2],
            "moieties": [m for m in (r[3] or "").split("+") if m],
            "is_high_alert": bool(r[4]), "nlem_level": r[5], "route_hint": r[6]}


def _strength_ok(name_norm, strengths):
    compact = (name_norm or "").replace(" ", "")
    return all(s in compact for s in strengths)


def _brand_heads(cur, kb: KnowledgeBase):
    with _heads_lock:
        if _heads["version"] != kb.version:
            cur.execute("SELECT DISTINCT split_part(name_norm, ' ', 1) FROM smartrx.medication_catalog_items WHERE name_norm IS NOT NULL")
            _heads["words"] = sorted(w for (w,) in cur.fetchall() if len(w) >= 4)
            _heads["version"] = kb.version
        return _heads["words"]


def _pick(cands, strengths):
    """Choose among catalogue candidates; flag ambiguity when they disagree on active ingredients."""
    pool = [c for c in cands if _strength_ok(c["name_norm"], strengths)] if strengths else cands
    strength_matched = bool(strengths and pool)
    pool = pool or cands
    if not pool:
        return None, False, False
    distinct = {tuple(sorted(c["moieties"])) for c in pool}
    return pool[0], len(distinct) > 1, strength_matched


def resolve(cur, kb: KnowledgeBase, text: str, strength_hint: Optional[str] = None) -> Resolution:
    text = (text or "").strip()
    res = Resolution(input=text)
    full_norm = normalize_text(text)
    core, strengths = split_name_strength(text)
    if strength_hint:
        strengths = strengths + [s for s in split_name_strength("x " + strength_hint)[1] if s not in strengths]
    res.strengths = strengths
    if not core:
        return res

    def fetch(where, params, limit=25):
        cur.execute(f"SELECT {_COLS} FROM smartrx.medication_catalog_items WHERE {where} ORDER BY length(name_norm), id LIMIT {limit}", params)
        out = []
        for r in cur.fetchall():
            c = _row_to_candidate(r)
            c["name_norm"] = r[7]
            out.append(c)
        return out

    def fill(c, method, confidence, ambiguous, interpreted=None):
        res.matched, res.method, res.confidence, res.ambiguous = True, method, confidence, ambiguous
        res.interpreted_as = interpreted
        res.brand, res.generic = c["brand"], c.get("generic")
        res.moieties = c["moieties"]
        res.is_high_alert, res.nlem_level, res.route_hint = c["is_high_alert"], c["nlem_level"], c["route_hint"]

    # 1. exact brand string
    exact = fetch("name_norm = %s", (full_norm,), 5)
    if exact:
        fill(exact[0], "brand_exact", 1.0, len({tuple(sorted(c["moieties"])) for c in exact}) > 1)
        if res.ambiguous:
            res.confidence = 0.6
        return res

    # 2a. combination names (co-trimoxazole, co-amoxiclav)
    syn = kb.synonyms.get(core) or kb.synonyms.get(core.replace("-", " "))
    if syn:
        res.matched, res.method, res.confidence = True, "substance_name", 0.9
        res.moieties = sorted(syn)
        res.generic = " + ".join(kb.moiety_label(m) for m in res.moieties)
        return res

    # 2. one or more active substances named directly ("metformin 500", "amoxicillin + clavulanic acid")
    parts = [p for p in re.split(r"\s*(?:\+|\band\b|/)\s*", core) if p]
    moieties, resolved_names = [], []
    for p in parts:
        m = kb.moiety_for_name(p)
        if m is None:
            moieties = []
            break
        moieties.append(m)
        resolved_names.append(kb.moiety_label(m))
    if moieties:
        res.matched, res.method, res.confidence = True, "substance_name", 0.9
        res.moieties = sorted(set(moieties))
        res.generic = " + ".join(resolved_names)
        return res

    # 3. brand, matched on whole leading words so 'dolo' never swallows 'dolopar'
    cands = fetch("(name_norm = %s OR name_norm LIKE %s)", (core, core + " %"))
    if cands:
        best, ambiguous, strength_matched = _pick(cands, strengths)
        res.candidates = [{"brand": c["brand"], "moieties": c["moieties"]} for c in cands[:5]]
        fill(best, "brand_prefix", 0.6 if ambiguous else (0.95 if (strength_matched or not strengths) else 0.85), ambiguous)
        return res

    # 4. last resort: typo tolerance on the leading word
    head = core.split()[0]
    pool = difflib.get_close_matches(head, _brand_heads(cur, kb), n=3, cutoff=FUZZY_MIN_RATIO)
    names = difflib.get_close_matches(head, [n for n in kb.name_to_moiety if " " not in n], n=1, cutoff=FUZZY_MIN_RATIO)
    if names and (not pool or difflib.SequenceMatcher(None, head, names[0]).ratio() >= difflib.SequenceMatcher(None, head, pool[0]).ratio()):
        res.matched, res.method = True, "fuzzy"
        res.confidence = round(difflib.SequenceMatcher(None, head, names[0]).ratio() * 0.8, 2)
        res.moieties = [kb.name_to_moiety[names[0]]]
        res.generic = kb.moiety_label(res.moieties[0])
        res.interpreted_as = names[0]
        return res
    if pool:
        rest = core[len(head):].strip()
        corrected = (pool[0] + " " + rest).strip()
        cands = fetch("(name_norm = %s OR name_norm LIKE %s)", (corrected, corrected + " %")) or fetch("(name_norm = %s OR name_norm LIKE %s)", (pool[0], pool[0] + " %"))
        if cands:
            best, ambiguous, _ = _pick(cands, strengths)
            fill(best, "fuzzy", round(difflib.SequenceMatcher(None, head, pool[0]).ratio() * 0.8, 2), ambiguous, pool[0])
            return res
    return res
