"""Deterministic prescription safety evaluation. No LLM is involved in any alert.

Every alert is non-blocking: the prescriber stays in control. When the engine cannot check
something (unrecognised drug, no renal function, allergy text it cannot interpret) it says so
explicitly instead of staying silent.
"""
import re
from . import allergy as allergy_mod
from . import checks
from . import resolver as resolver_mod
from .clinical import parse_duration_days, parse_number
from .config import ENGINE_VERSION
from .context import PatientContext
from .knowledge import KnowledgeBase

_SEV_RANK = {"critical": 0, "warning": 1, "info": 2}
_PARENTERAL = {"iv", "im", "sc", "intravenous", "intramuscular", "subcutaneous", "parenteral", "injection", "infusion"}
_ROUTE_ALIAS = {"intravenous": "iv", "intramuscular": "im", "subcutaneous": "sc", "subcut": "sc", "inj": "injection"}
_LAB_PARAM = {"serum potassium": "potassium", "potassium": "potassium"}


def _source_ref(d):
    """'SRC_012, p.34' when a guideline page is cited, else None."""
    if d.get("source_id"):
        return d["source_id"] + (f", p.{d['source_page']}" if d.get("source_page") else "")
    return None


def _alert(aid, check, severity, title, message, recommendation, source, drug_name, rule=None, **extra):
    a = {"id": aid, "check": check, "drug_name": drug_name, "severity": severity, "is_blocking": False,
         "title": title, "message": message, "recommendation": recommendation, "source": source}
    if rule is not None:
        a["rule_id"] = rule["id"]
        a["knowledge_status"] = rule["status"]
        a["provenance"] = rule.get("provenance")
        a["source_ref"] = _source_ref(rule)
    a.update(extra)
    return a


def _compare(op, actual, threshold):
    op = (op or "").strip().upper()
    if op == "IN":
        opts = {t.strip().lower() for t in str(threshold).split(",")}
        return str(actual).strip().lower() in opts
    if isinstance(actual, (int, float)):
        t = parse_number(threshold)
        if t is None:
            return None
        return {"<": actual < t, "<=": actual <= t, ">": actual > t, ">=": actual >= t,
                "==": actual == t, "!=": actual != t}.get(op)
    a, t = str(actual).strip().lower(), str(threshold).strip().lower()
    return {"==": a == t, "!=": a != t}.get(op)


def _norm_route(value):
    toks = {_ROUTE_ALIAS.get(t, t) for t in re.findall(r"[a-z]+", str(value or "").lower())}
    return toks


def _route_state(item, res, wanted):
    """True/False/None(unknown) for 'is this item given by one of the wanted routes'."""
    given = _norm_route(item.get("route"))
    if given:
        return bool(given & wanted) or (bool(given & _PARENTERAL) and bool(wanted & _PARENTERAL) and "injection" in given)
    hint = res.route_hint
    if hint == "parenteral":
        return None if wanted & _PARENTERAL else False
    if hint in ("oral", "topical", "ophthalmic", "inhalation"):
        return False
    return None


def _rule_applies(rule, item, res, ctx: PatientContext, idx, state):
    """Return an alert, or None. Mutates state for coverage reporting."""
    param = (rule["parameter"] or "").strip().lower()
    cat = rule["category"]
    drug = item["name"]
    lab_note = ""

    if param == "egfr":
        if ctx.egfr is None:
            state["renal_unknown"].setdefault(idx, rule["drug_name"])
            return None
        hit = _compare(rule["operator"], ctx.egfr, rule["threshold"])
        if not hit:
            return None
        if ctx.egfr_stale:
            lab_note = f" (note: the renal result is older than the freshness window, measured {ctx.egfr_measured_at})"
        return _alert(f"rule-{rule['id']}-{idx}", "renal", rule["severity"],
                      f"Renal Safety Alert (eGFR {ctx.egfr} mL/min/1.73m²)", rule["message"] + lab_note,
                      rule["recommendation"], rule["source"], drug, rule=rule,
                      egfr=ctx.egfr, egfr_source=ctx.egfr_source)

    if param == "pregnancy status":
        if ctx.pregnant and str(rule["threshold"]).strip().lower() == "pregnant" and rule["operator"].strip() == "==":
            return _alert(f"rule-{rule['id']}-{idx}", "pregnancy", rule["severity"], "Pregnancy Safety Alert",
                          rule["message"], rule["recommendation"], rule["source"], drug, rule=rule)
        return None

    if param in _LAB_PARAM:
        value = ctx.labs.get(_LAB_PARAM[param])
        if value is None:
            state["not_evaluated"].add(f"{rule['drug_name']}: {rule['parameter']} not on record")
            return None
        if _compare(rule["operator"], value, rule["threshold"]):
            return _alert(f"rule-{rule['id']}-{idx}", "lab", rule["severity"], f"Lab-based Alert ({rule['parameter']} {value})",
                          rule["message"], rule["recommendation"], rule["source"], drug, rule=rule)
        return None

    if param == "classification":
        return _alert(f"rule-{rule['id']}-{idx}", "stewardship" if cat == "ANTIMICROBIAL_STEWARDSHIP" else "high_alert",
                      rule["severity"], "ISMP High-Alert Medication" if cat == "HIGH_ALERT_MEDICATION" else "Reserve Antibiotic",
                      rule["message"], rule["recommendation"], rule["source"], drug, rule=rule)

    if param == "duration":
        days = parse_duration_days(item.get("duration"))
        if days is None:
            state["not_evaluated"].add(f"{rule['drug_name']}: duration not stated")
            return None
        if _compare(rule["operator"], days, rule["threshold"]):
            return _alert(f"rule-{rule['id']}-{idx}", "stewardship", rule["severity"], "Antimicrobial Stewardship Alert",
                          rule["message"], rule["recommendation"], rule["source"], drug, rule=rule, duration_days=days)
        return None

    if param in ("route", "dosage form"):
        generic_msg = " (route / dosage form was not specified, so this applies to all forms of the drug)"
        if param == "route":
            wanted = {_ROUTE_ALIAS.get(t.strip().lower(), t.strip().lower()) for t in str(rule["threshold"]).split(",")}
            state_ = _route_state(item, res, wanted)
        else:
            text = " ".join(str(x or "") for x in (item.get("dosage_form"), item.get("form"), item["name"], res.generic)).lower()
            wants_conc = "concentrat" in str(rule["threshold"]).lower()
            given = _norm_route(item.get("route"))
            if given and not (given & _PARENTERAL):
                state_ = False  # the prescriber stated a non-injection route
            elif wants_conc and "concentrat" in text and re.search(r"inject|infusion", text):
                state_ = True
            elif res.route_hint in ("oral", "topical", "ophthalmic", "inhalation"):
                state_ = False
            elif res.route_hint == "parenteral" or re.search(r"inject|infusion|\biv\b", text):
                state_ = None
            else:
                state_ = None
        if state_ is False:
            return None
        sev = rule["severity"] if state_ else "warning"
        return _alert(f"rule-{rule['id']}-{idx}", "high_alert", sev, "ISMP High-Alert Medication",
                      rule["message"] + ("" if state_ else generic_msg), rule["recommendation"], rule["source"], drug, rule=rule)

    state["not_evaluated"].add(f"{rule['drug_name']}: parameter '{rule['parameter']}' is not evaluable yet")
    return None


def evaluate(cur, kb: KnowledgeBase, ctx: PatientContext, items: list, hospital_id=None) -> dict:
    alerts, resolved, partial = [], [], []
    state = {"renal_unknown": {}, "not_evaluated": set()}

    # 1. resolve every prescribed line
    for idx, it in enumerate(items):
        name = (it.get("medicine") or it.get("name") or "").strip()
        res = resolver_mod.resolve(cur, kb, name, it.get("strength"))
        resolved.append((idx, {**it, "name": name}, res))

    names_by_id = lambda moieties: ", ".join(kb.moiety_label(m) for m in moieties)  # noqa: E731

    for idx, item, res in resolved:
        name = item["name"]
        if not res.matched:
            partial.append(f"unrecognised_drug:{name}")
            alerts.append(_alert(f"unmapped-{idx}", "coverage", "info", "Manual / Unverified Formulary Drug",
                                 f"'{name}' was not matched to the drug catalogue. Deterministic safety checks are limited for this item.",
                                 "Verify the formulation, active ingredient and strength manually.",
                                 "SmartRx catalogue resolution", name))
        elif not res.moieties:
            partial.append(f"no_ingredient_mapping:{name}")
            alerts.append(_alert(f"unmapped-{idx}", "coverage", "info", "Active Ingredient Not Mapped",
                                 f"'{name}' ({res.brand}) is in the catalogue but has no active-ingredient mapping, so allergy, duplicate and dosing checks could not run.",
                                 "Verify the active ingredient manually.", "SmartRx catalogue resolution", name))
        elif res.ambiguous:
            partial.append(f"ambiguous_drug:{name}")
            alerts.append(_alert(f"ambiguous-{idx}", "coverage", "info", "Ambiguous Medicine Name",
                                 f"'{name}' matches products with different active ingredients; '{res.brand}' ({res.generic}) was assumed.",
                                 "Select the exact product from the catalogue search.", "SmartRx catalogue resolution", name,
                                 candidates=res.candidates))
        elif res.method == "fuzzy":
            partial.append(f"spelling_corrected:{name}")
            alerts.append(_alert(f"fuzzy-{idx}", "coverage", "info", "Medicine Name Interpreted",
                                 f"'{name}' was read as '{res.interpreted_as}'. Confirm this is the intended medicine.",
                                 "Select the exact product from the catalogue search.", "SmartRx catalogue resolution", name))

    def moieties_of(item, res):
        """Active moieties used for checks; unresolved lines fall back to substance words in their text."""
        if res.moieties:
            return set(res.moieties), "catalogue"
        words = re.findall(r"[a-z][a-z-]{3,}", item["name"].lower())
        found = {m for m in (kb.moiety_for_name(w) for w in words) if m}
        return found, "name_text"

    # 2. allergy + cross-reactivity
    for entry in ctx.allergies:
        if entry.kind == "unmapped":
            alerts.append(_alert(f"allergy-unmapped-{entry.text[:30]}", "allergy", "info", "Allergy Not Interpreted",
                                 f"The recorded allergy '{entry.text}' could not be matched to a drug or drug class and was NOT checked against this prescription.",
                                 "Review the allergy record and enter the allergen as a drug or class.", "SmartRx allergy matching",
                                 entry.text))
            partial.append(f"allergy_not_interpreted:{entry.text}")
            continue
        covered = allergy_mod.allergen_moieties(entry, kb)
        label = kb.classes[entry.code]["name"] if entry.kind == "class" and entry.code in kb.classes else kb.moiety_label(entry.code)
        status = kb.classes[entry.code]["status"] if entry.kind == "class" and entry.code in kb.classes else "approved"
        from_classes = {entry.code} if entry.kind == "class" else kb.moiety_classes.get(entry.code, set())
        for idx, item, res in resolved:
            ing, basis = moieties_of(item, res)
            hit = ing & covered
            if hit:
                sev_note = f" Recorded reaction: {entry.reaction}." if entry.reaction else ""
                alerts.append(_alert(f"allergy-{idx}-{entry.code}", "allergy", "critical",
                                     f"Critical Allergy Conflict: {label}",
                                     f"Patient has a documented allergy to {label} ('{entry.text}'). '{item['name']}' contains {names_by_id(sorted(hit))}.{sev_note}",
                                     "Choose an alternative from a different drug class, or document a clinical override.",
                                     "SmartRx Clinical Safety Engine / CDCI SubstanceMaster", item["name"],
                                     allergen=label, allergy_severity=entry.severity, matched_on=basis, knowledge_status=status))
                continue
            for x in kb.cross:
                if x["from_class"] in from_classes and x["to_class"] in kb.classes and ing & kb.classes[x["to_class"]]["members"]:
                    alerts.append(_alert(f"xreact-{idx}-{entry.code}-{x['to_class']}", "allergy", x["severity"],
                                         f"Possible Cross-Reactivity: {label} → {kb.classes[x['to_class']]['name']}",
                                         x["message"], x["recommendation"], x["source"], item["name"],
                                         allergen=label, matched_on=basis, knowledge_status=x["status"],
                                         provenance=x.get("provenance"), source_ref=_source_ref(x)))

    # 3. duplicate therapy (same active moiety on two lines)
    for i in range(len(resolved)):
        for j in range(i + 1, len(resolved)):
            a_ing, _ = moieties_of(resolved[i][1], resolved[i][2])
            b_ing, _ = moieties_of(resolved[j][1], resolved[j][2])
            shared = a_ing & b_ing
            if shared:
                n1, n2 = resolved[i][1]["name"], resolved[j][1]["name"]
                alerts.append(_alert(f"duplicate-{i}-{j}", "duplicate", "warning", "Duplicate Therapy Alert",
                                     f"'{n1}' and '{n2}' both contain {names_by_id(sorted(shared))}.",
                                     "Review the cumulative daily dose to avoid accidental overdose, or remove one line.",
                                     "SmartRx Rules Engine / CDCI active-ingredient mapping", f"{n1}, {n2}",
                                     shared_ingredients=[kb.moiety_label(m) for m in sorted(shared)]))

    # 4. typed clinical rules
    rule_covered = {"pregnancy": set(), "stewardship": set()}
    for idx, item, res in resolved:
        ing, _ = moieties_of(item, res)
        if not ing:
            continue
        seen, renal_best = set(), {}
        for rule in kb.rules:
            if rule["moieties"] & ing:
                a = _rule_applies(rule, item, res, ctx, idx, state)
                if not a or a["id"] in seen:
                    continue
                seen.add(a["id"])
                if a["check"] in rule_covered:
                    rule_covered[a["check"]].add(idx)
                if a["check"] == "renal":
                    # A contraindication supersedes a milder dose-reduction rule for the same drug.
                    group = rule["drug_name"].lower()
                    best = renal_best.get(group)
                    if best is None or _SEV_RANK[a["severity"]] < _SEV_RANK[best["severity"]]:
                        renal_best[group] = a
                    continue
                alerts.append(a)
        alerts.extend(renal_best.values())

    # 5. Phase 2: interactions, dose limits, pregnancy/lactation, antibiotic policy, formulary
    lines = [(idx, item, res, moieties_of(item, res)[0]) for idx, item, res in resolved]
    current = []
    for med in ctx.current_meds:
        cres = resolver_mod.resolve(cur, kb, med["name"])
        cing, _ = moieties_of({"name": med["name"]}, cres)
        if cing:
            current.append((med["name"], cing, med["source"]))
        else:
            state["not_evaluated"].add(f"{med['name']} (current medication): not recognised, interactions not checked")
    alerts.extend(checks.interactions(kb, [(i, it["name"], ing) for i, it, _, ing in lines if ing], current))
    alerts.extend(checks.dose_limits(kb, ctx, [l for l in lines if l[3]], state["not_evaluated"]))
    alerts.extend(checks.reproductive(kb, ctx, [l for l in lines if l[3]], rule_covered["pregnancy"], state["not_evaluated"]))
    alerts.extend(checks.policy_and_formulary(cur, kb, hospital_id, [l for l in lines if l[3]], rule_covered["stewardship"]))

    for idx, drug in state["renal_unknown"].items():
        name = resolved[idx][1]["name"]
        partial.append(f"renal_function_unknown:{name}")
        alerts.append(_alert(f"renal-unknown-{idx}", "renal", "info", f"Renal Function Not On Record ({drug})",
                             f"'{name}' needs renal dose checking, but no recent eGFR/creatinine (or the data needed to compute eGFR) is available, so it was not checked.",
                             "Enter a recent eGFR or serum creatinine (with age and sex) and re-check.",
                             "KDIGO 2024 CKD Guideline", name))

    for m in ctx.missing:
        if m.startswith("egfr_not_computed") or m == "allergy_status_not_recorded":
            partial.append(m)
    alerts.sort(key=lambda a: (_SEV_RANK.get(a["severity"], 3), a["id"]))
    return {
        "engine_version": ENGINE_VERSION,
        "rule_set_version": kb.version,
        "check_status": "partial" if partial else "complete",
        "partial_reasons": sorted(set(partial)),
        "evaluated_count": len(resolved),
        "has_critical": any(a["severity"] == "critical" for a in alerts),
        "has_warning": any(a["severity"] == "warning" for a in alerts),
        "alerts": alerts,
        "items": [{"index": i, "input": r.input, "matched": r.matched, "method": r.method, "confidence": r.confidence,
                   "ambiguous": r.ambiguous, "brand": r.brand, "generic": r.generic,
                   "ingredients": [kb.moiety_label(m) for m in r.moieties], "nlem_level": r.nlem_level}
                  for i, _, r in resolved],
        "context": ctx.summary(),
        "coverage": {"rules_not_evaluated": sorted(state["not_evaluated"])},
    }
