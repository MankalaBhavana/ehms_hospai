"""In-memory snapshot of the loaded knowledge (substances, classes, rules), versioned and cached."""
import threading
import time
from dataclasses import dataclass, field

from .config import ACTIVE_STATUSES, ALLOW_UNSOURCED, RULE_CACHE_SECONDS
from .textnorm import name_key


class KnowledgeUnavailable(RuntimeError):
    """The smartrx schema or its knowledge has not been loaded."""


@dataclass
class KnowledgeBase:
    version: str
    name_to_moiety: dict = field(default_factory=dict)   # lower substance name -> moiety id
    key_to_moiety: dict = field(default_factory=dict)    # name_key -> moiety id
    moiety_name: dict = field(default_factory=dict)      # moiety id -> display name
    classes: dict = field(default_factory=dict)          # code -> {name,status,members:set}
    alias_to_class: dict = field(default_factory=dict)   # alias -> code
    moiety_classes: dict = field(default_factory=dict)   # moiety id -> set(class codes)
    cross: list = field(default_factory=list)
    synonyms: dict = field(default_factory=dict)         # name -> set(moiety ids)
    rules: list = field(default_factory=list)
    interactions: list = field(default_factory=list)      # {a:set,b:set,severity,...}
    ix_by_moiety: dict = field(default_factory=dict)      # moiety -> [interaction index]
    dose_limits: dict = field(default_factory=dict)       # moiety -> [limit dicts]
    repro: list = field(default_factory=list)             # {moieties:set,context,severity,...}
    policy: dict = field(default_factory=dict)            # moiety -> global antibiotic policy row
    loaded_at: float = 0.0

    def moiety_for_name(self, text):
        t = (text or "").strip().lower()
        if not t:
            return None
        found = self.name_to_moiety.get(t) or self.key_to_moiety.get(name_key(t))
        if found:
            return found
        syn = self.synonyms.get(t)
        return next(iter(syn)) if syn and len(syn) == 1 else None

    def moiety_label(self, moiety_id):
        return self.moiety_name.get(moiety_id, moiety_id)


_lock = threading.Lock()
_cache = {"kb": None}


def _load(cur, version) -> KnowledgeBase:
    kb = KnowledgeBase(version=version)
    cur.execute("SELECT identifier, substance_name, moiety_identifier FROM smartrx.substance_master")
    for ident, name, moiety in cur.fetchall():
        moiety = moiety or ident
        kb.name_to_moiety[name.lower()] = moiety
        kb.key_to_moiety.setdefault(name_key(name), moiety)
        if ident == moiety:
            kb.moiety_name[moiety] = name

    statuses = list(ACTIVE_STATUSES)
    cur.execute("SELECT class_code, class_name, status FROM smartrx.drug_class WHERE status = ANY(%s)", (statuses,))
    for code, name, status in cur.fetchall():
        kb.classes[code] = {"name": name, "status": status, "members": set()}
    cur.execute("SELECT class_code, moiety_identifier FROM smartrx.drug_class_member")
    for code, moiety in cur.fetchall():
        if code in kb.classes:
            kb.classes[code]["members"].add(moiety)
            kb.moiety_classes.setdefault(moiety, set()).add(code)
    cur.execute("SELECT class_code, alias FROM smartrx.drug_class_alias")
    for code, alias in cur.fetchall():
        if code in kb.classes:
            kb.alias_to_class[alias.lower()] = code
    for code, c in kb.classes.items():
        kb.alias_to_class.setdefault(c["name"].lower(), code)
        kb.alias_to_class.setdefault(code.lower().replace("_", " "), code)

    cur.execute("SELECT synonym, moiety_identifier FROM smartrx.drug_synonym")
    for syn, moiety in cur.fetchall():
        kb.synonyms.setdefault(syn.lower(), set()).add(moiety)

    cur.execute("""SELECT from_class, to_class, severity, message, recommendation, source, status, provenance, source_id, source_page
                   FROM smartrx.cross_reactivity WHERE status = ANY(%s) AND (provenance <> 'unsourced' OR %s)""", (statuses, ALLOW_UNSOURCED))
    kb.cross = [dict(zip(("from_class", "to_class", "severity", "message", "recommendation", "source", "status", "provenance", "source_id", "source_page"), r))
                for r in cur.fetchall()]

    cur.execute("""SELECT r.id, r.drug_name, r.category, r.parameter, r.operator, r.threshold, r.unit, r.severity,
                          r.is_blocking, r.message, r.recommendation, r.source, r.status, r.provenance, r.source_id, r.source_page,
                          COALESCE(array_agg(m.moiety_identifier) FILTER (WHERE m.moiety_identifier IS NOT NULL), '{}')
                   FROM smartrx.clinical_rules r LEFT JOIN smartrx.rule_moiety m ON m.rule_id = r.id
                   WHERE r.status = ANY(%s) AND (r.provenance <> 'unsourced' OR %s) GROUP BY r.id ORDER BY r.id""", (statuses, ALLOW_UNSOURCED))
    cols = ("id", "drug_name", "category", "parameter", "operator", "threshold", "unit", "severity",
            "is_blocking", "message", "recommendation", "source", "status", "provenance", "source_id", "source_page")
    for row in cur.fetchall():
        rule = dict(zip(cols, row[:16]))
        rule["moieties"] = set(row[16] or [])
        kb.rules.append(rule)
    _load_phase2(cur, kb, statuses)
    _attach_jurisdiction(cur, kb)
    kb.loaded_at = time.monotonic()
    return kb


def _attach_jurisdiction(cur, kb):
    """Stamp each knowledge row with the jurisdiction (India/WHO/US/International) of the guideline it cites."""
    cur.execute("SELECT source_id, jurisdiction FROM smartrx.guideline_source")
    jur = dict(cur.fetchall())
    rows = list(kb.rules) + list(kb.cross) + list(kb.interactions) + list(kb.repro) + list(kb.policy.values())
    for limits in kb.dose_limits.values():
        rows.extend(limits)
    for d in rows:
        d["jurisdiction"] = jur.get(d.get("source_id")) if d.get("source_id") else None


def _members(kb, kind, ref):
    if kind == "substance":
        return {ref}
    c = kb.classes.get(ref)
    return set(c["members"]) if c else set()


def _load_phase2(cur, kb, statuses):
    cur.execute("""SELECT id, a_kind, a_ref, b_kind, b_ref, severity, mechanism, message, recommendation, source, evidence,
                          evidence_excerpt, status, provenance, source_id, source_page FROM smartrx.drug_interaction WHERE status = ANY(%s) AND (provenance <> 'unsourced' OR %s) ORDER BY id""", (statuses, ALLOW_UNSOURCED))
    keys = ("id", "a_kind", "a_ref", "b_kind", "b_ref", "severity", "mechanism", "message", "recommendation", "source",
            "evidence", "excerpt", "status", "provenance", "source_id", "source_page")
    for row in cur.fetchall():
        ix = dict(zip(keys, row))
        ix["a"], ix["b"] = _members(kb, ix["a_kind"], ix["a_ref"]), _members(kb, ix["b_kind"], ix["b_ref"])
        if not ix["a"] or not ix["b"]:
            continue  # refers to a class that is not active
        idx = len(kb.interactions)
        kb.interactions.append(ix)
        for m in ix["a"] | ix["b"]:
            kb.ix_by_moiety.setdefault(m, []).append(idx)

    cur.execute("""SELECT moiety_identifier, population, max_single_mg, max_daily_mg, max_mg_per_kg_day, max_doses_per_week,
                          note, source, status, provenance, source_id, source_page FROM smartrx.dose_limit WHERE status = ANY(%s) AND (provenance <> 'unsourced' OR %s)""", (statuses, ALLOW_UNSOURCED))
    for m, pop, single, daily, perkg, perweek, note, source, status, prov, sid, spage in cur.fetchall():
        f = lambda v: float(v) if v is not None else None  # noqa: E731
        kb.dose_limits.setdefault(m, []).append({"population": pop, "max_single_mg": f(single), "max_daily_mg": f(daily),
                                                 "max_mg_per_kg_day": f(perkg), "max_doses_per_week": f(perweek),
                                                 "note": note, "source": source, "status": status,
                                                 "provenance": prov, "source_id": sid, "source_page": spage})

    cur.execute("""SELECT id, target_kind, target_ref, context, severity, message, recommendation, source, status, provenance, source_id, source_page
                   FROM smartrx.reproductive_risk WHERE status = ANY(%s) AND (provenance <> 'unsourced' OR %s) ORDER BY id""", (statuses, ALLOW_UNSOURCED))
    for rid, kind, ref, context, severity, message, rec, source, status, prov, sid, spage in cur.fetchall():
        members = _members(kb, kind, ref)
        if members:
            kb.repro.append({"id": rid, "moieties": members, "context": context, "severity": severity, "message": message,
                             "recommendation": rec, "source": source, "status": status,
                             "provenance": prov, "source_id": sid, "source_page": spage, "label": kb.moiety_label(ref) if kind == "substance" else kb.classes[ref]["name"]})

    cur.execute("""SELECT moiety_identifier, tier, restricted_to, requires_justification, message, source, status, provenance, source_id, source_page
                   FROM smartrx.antibiotic_policy WHERE hospital_id IS NULL AND status = ANY(%s) AND (provenance <> 'unsourced' OR %s)""", (statuses, ALLOW_UNSOURCED))
    for m, tier, restricted_to, needs, message, source, status, prov, sid, spage in cur.fetchall():
        kb.policy[m] = {"tier": tier, "restricted_to": restricted_to, "requires_justification": needs, "message": message,
                        "source": source, "status": status, "provenance": prov, "source_id": sid, "source_page": spage}


def get_knowledge(cur) -> KnowledgeBase:
    """Return the cached snapshot, reloading when the rule-set version changed (checked at most every N s)."""
    kb = _cache["kb"]
    if kb is not None and time.monotonic() - kb.loaded_at < RULE_CACHE_SECONDS:
        return kb
    with _lock:
        try:
            cur.execute("SELECT version FROM smartrx.rule_set_state WHERE id = 1")
            row = cur.fetchone()
        except Exception as exc:  # schema missing, etc.
            raise KnowledgeUnavailable(str(exc)) from exc
        if not row:
            raise KnowledgeUnavailable("smartrx knowledge has not been loaded (run the ingest pipeline)")
        kb = _cache["kb"]
        if kb is not None and kb.version == row[0]:
            kb.loaded_at = time.monotonic()
            return kb
        _cache["kb"] = _load(cur, row[0])
        return _cache["kb"]


def reset_cache():
    with _lock:
        _cache["kb"] = None
