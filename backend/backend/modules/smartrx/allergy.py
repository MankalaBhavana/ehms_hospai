"""Structured allergies: parse legacy free text, resolve to substances/classes, persist and load."""
import re
from dataclasses import dataclass, asdict
from typing import Optional

from .knowledge import KnowledgeBase
from .textnorm import normalize_text

_NO_KNOWN = re.compile(r"\b(nkda|nka|nkfa|no known|none known|no allerg|not known|nil)\b|^\s*(none|nil|no|n/a|na|-)\s*$", re.I)
_SEVERITY_WORDS = {"severe": "severe", "anaphylaxis": "severe", "anaphylactic": "severe", "life threatening": "severe",
                   "moderate": "moderate", "mild": "mild"}
_REACTION_WORDS = {"hives", "urticaria", "rash", "itching", "swelling", "angioedema", "anaphylaxis", "anaphylactic",
                   "wheeze", "wheezing", "vomiting", "nausea", "diarrhea", "diarrhoea", "breathlessness", "shock",
                   "sjs", "ten", "fever", "cough", "bronchospasm"}
_FILLER = {"allergy", "allergies", "allergic", "to", "history", "of", "known", "hypersensitivity", "reaction",
           "reactions", "intolerance", "drug", "drugs", "a", "an", "the", "on", "with", "causes", "causing", "after",
           "tablet", "tablets", "injection", "syrup", "and", "also", "patient", "pt", "has", "have", "had", "is", "-",
           "severe", "mild", "moderate", "life", "threatening", "type", "suspected", "possible", "documented"}
_SPLIT = re.compile(r"[,;/\n]|\band\b|&|\bwith\b|\bplus\b", re.I)


@dataclass
class AllergyEntry:
    kind: str                    # substance | class | unmapped
    code: Optional[str]          # moiety id or class code
    text: str
    reaction: Optional[str] = None
    severity: str = "unknown"
    source: str = "free_text"

    def as_dict(self):
        return asdict(self)


def parse_free_text(text, kb: KnowledgeBase):
    """Return (entries, no_known_allergy). Never raises on odd input."""
    raw = str(text or "").strip()
    if not raw:
        return [], False
    entries = []
    for chunk in _SPLIT.split(raw):
        norm = normalize_text(chunk)
        if not norm:
            continue
        severity, reactions, words = "unknown", [], []
        for phrase, sev in _SEVERITY_WORDS.items():
            if re.search(rf"\b{phrase}\b", norm):
                severity = sev if severity in ("unknown",) or sev == "severe" else severity
        for tok in norm.split():
            if tok in _REACTION_WORDS:
                reactions.append(tok)
            elif tok not in _FILLER:
                words.append(tok)
        term = " ".join(words).strip()
        if not term:
            # "Hives" on its own describes the previous allergen
            if reactions and entries:
                entries[-1].reaction = ", ".join(filter(None, [entries[-1].reaction, ", ".join(reactions)]))
                if severity != "unknown" and entries[-1].severity == "unknown":
                    entries[-1].severity = severity
            continue
        entry = resolve_allergen(term, kb)
        entry.reaction = ", ".join(reactions) or None
        entry.severity = severity
        entry.text = chunk.strip()[:300]
        entries.append(entry)
    negations = {"no", "none", "nil", "nka", "nkda", "nkfa", "not", "na", "n/a"}
    entries = [e for e in entries if not (e.kind == "unmapped" and (set(normalize_text(e.text).split()) - _FILLER - {"known"}) <= negations)]
    if not entries and _NO_KNOWN.search(raw):
        return [], True
    return entries, False


def resolve_allergen(term: str, kb: KnowledgeBase) -> AllergyEntry:
    t = normalize_text(term)
    code = kb.alias_to_class.get(t)
    if code:
        return AllergyEntry("class", code, term)
    moiety = kb.moiety_for_name(t)
    if moiety:
        return AllergyEntry("substance", moiety, term)
    # "penicillin allergy" -> token-level: any single token that is a class alias or substance
    toks = t.split()
    if len(toks) > 1:
        for tok in toks:
            code = kb.alias_to_class.get(tok)
            if code:
                return AllergyEntry("class", code, term)
        for tok in toks:
            moiety = kb.moiety_for_name(tok)
            if moiety:
                return AllergyEntry("substance", moiety, term)
    return AllergyEntry("unmapped", None, term)


def allergen_moieties(entry: AllergyEntry, kb: KnowledgeBase) -> set:
    """Moiety ids an allergy entry covers (a class covers every member)."""
    if entry.kind == "substance" and entry.code:
        return {entry.code}
    if entry.kind == "class" and entry.code in kb.classes:
        return set(kb.classes[entry.code]["members"])
    return set()


# ---- persistence -------------------------------------------------------------------------------------

def load_structured(cur, hospital_id, patient_id):
    cur.execute("""SELECT allergen_kind, allergen_code, allergen_text, reaction, severity, source
                   FROM smartrx.patient_allergy
                   WHERE COALESCE(hospital_id, 0) = COALESCE(%s, 0) AND patient_id = %s AND status = 'active'
                   ORDER BY id""", (hospital_id, str(patient_id)))
    return [AllergyEntry(k, c, t, r, s, src) for k, c, t, r, s, src in cur.fetchall()]


def save_entry(cur, hospital_id, patient_id, entry: AllergyEntry, recorded_by=None):
    """Insert, or update the existing active row for the same allergen. Returns the row id."""
    cur.execute("""SELECT id FROM smartrx.patient_allergy
                   WHERE COALESCE(hospital_id,0)=COALESCE(%s,0) AND patient_id=%s AND allergen_kind=%s
                     AND COALESCE(allergen_code, LOWER(allergen_text)) = COALESCE(%s, LOWER(%s)) AND status='active'""",
                (hospital_id, str(patient_id), entry.kind, entry.code, entry.text))
    row = cur.fetchone()
    if row:
        cur.execute("""UPDATE smartrx.patient_allergy SET reaction=COALESCE(%s, reaction),
                         severity=CASE WHEN %s='unknown' THEN severity ELSE %s END, updated_at=NOW() WHERE id=%s""",
                    (entry.reaction, entry.severity, entry.severity, row[0]))
        return row[0]
    cur.execute("""INSERT INTO smartrx.patient_allergy (hospital_id, patient_id, allergen_kind, allergen_code,
                       allergen_text, reaction, severity, source, recorded_by)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (hospital_id, str(patient_id), entry.kind, entry.code, entry.text[:300], entry.reaction,
                 entry.severity, entry.source, recorded_by))
    return cur.fetchone()[0]
