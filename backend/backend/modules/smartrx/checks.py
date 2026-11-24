"""Phase 2 safety checks: interactions, dose limits, pregnancy/lactation, antibiotic policy, formulary.

Each function returns alerts only; none can block. Anything that could not be evaluated is reported through the
``notes`` collector so the response says what was NOT checked.
"""
from . import dosing
from .knowledge import KnowledgeBase

_RANK = {"critical": 0, "warning": 1, "info": 2}


def _p(d):
    """Knowledge-status and provenance fields for an alert built from knowledge row `d`."""
    ref = d["source_id"] + (f", p.{d['source_page']}" if d.get("source_page") else "") if d.get("source_id") else None
    return {"knowledge_status": d["status"], "provenance": d.get("provenance"), "source_ref": ref,
            "source_jurisdiction": d.get("jurisdiction")}


def _alert(aid, check, severity, title, message, recommendation, source, drug_name, status="approved", **extra):
    a = {"id": aid, "check": check, "drug_name": drug_name, "severity": severity, "is_blocking": False, "title": title,
         "message": message, "recommendation": recommendation, "source": source, "knowledge_status": status}
    a.update(extra)
    return a


# ---- interactions ---------------------------------------------------------------------------------------

def interactions(kb: KnowledgeBase, lines, current):
    """lines: [(index, name, moieties)] for this prescription; current: [(label, name, moieties, source)]."""
    alerts, best = [], {}
    pools = [(("rx", i), name, ing, "this prescription") for i, name, ing in lines] + \
            [(("cm", k), name, ing, src) for k, (name, ing, src) in enumerate(current)]
    for x in range(len(pools)):
        for y in range(x + 1, len(pools)):
            (kx, nx, ix, sx), (ky, ny, iy, sy) = pools[x], pools[y]
            if kx[0] == "cm" and ky[0] == "cm":
                continue  # existing-vs-existing is not this prescription's problem
            cand = set()
            for m in ix:
                cand.update(kb.ix_by_moiety.get(m, ()))
            for idx in cand:
                it = kb.interactions[idx]
                if (it["a"] & ix and it["b"] & iy) or (it["a"] & iy and it["b"] & ix):
                    hit_a = it["a"] & (ix if it["a"] & ix else iy)
                    hit_b = it["b"] & (iy if it["a"] & ix else ix)
                    key = (kx, ky)
                    rank = (_RANK[it["severity"]], 0 if it["evidence"] == "curated" else 1)
                    if key not in best or rank < best[key][0]:
                        best[key] = (rank, it, hit_a, hit_b, nx, ny, sx, sy)
    for (kx, ky), (_, it, hit_a, hit_b, nx, ny, sx, sy) in best.items():
        names = lambda hits: " / ".join(sorted(kb.moiety_label(m) for m in hits))  # noqa: E731
        pair = f"{names(hit_a)} + {names(hit_b)}"
        where = ""
        other = sy if kx[0] == "rx" else sx
        if other != "this prescription":
            where = f" ('{ny if kx[0] == 'rx' else nx}' is a {other}.)"
        if it["evidence"] == "label_text":
            alerts.append(_alert(f"interaction-{kx[0]}{kx[1]}-{ky[0]}{ky[1]}", "interaction", "info",
                                 f"Label-Reported Interaction (unreviewed): {pair}",
                                 f"{it['message']} Label text: “{it['excerpt']}”{where}", it["recommendation"] or "", it["source"],
                                 f"{nx}, {ny}", **_p(it), evidence="label_text"))
        else:
            mech = f" Mechanism: {it['mechanism']}." if it["mechanism"] else ""
            alerts.append(_alert(f"interaction-{kx[0]}{kx[1]}-{ky[0]}{ky[1]}", "interaction", it["severity"],
                                 f"Drug Interaction: {pair}", it["message"] + mech + where, it["recommendation"] or "",
                                 it["source"], f"{nx}, {ny}", **_p(it), evidence="curated"))
    return alerts


# ---- dose limits ----------------------------------------------------------------------------------------

def dose_limits(kb: KnowledgeBase, ctx, lines, notes):
    alerts = []
    child = ctx.age_years is not None and ctx.age_years < 18
    for idx, item, res, ing in lines:
        if len(ing) != 1:
            continue  # combination products: the strength cannot be attributed to one ingredient
        m = next(iter(ing))
        limits = kb.dose_limits.get(m)
        if not limits:
            continue
        name, label = item["name"], kb.moiety_label(m)
        est = dosing.estimate(item.get("strength"), item.get("dosage"), item.get("frequency"), res.strengths)
        if est.single_mg is None:
            notes.add(f"{name}: dose not checked (no usable strength/dose)")
            if est.doses_per_week is None:
                continue  # the weekly-frequency limit below still runs when a frequency was given
        if ctx.age_years is None:
            notes.add(f"{name}: dose not checked (patient age unknown)")
            continue
        pop = "child" if child else "adult"
        lim = [l for l in limits if l["population"] == pop]
        if not lim:
            notes.add(f"{name}: no {pop} dose limit on file for {label}")
            continue
        for l in lim:
            ass = f" (assumed: {'; '.join(est.assumptions)})" if est.assumptions else ""
            if l["max_doses_per_week"] is not None and est.doses_per_week is not None and est.doses_per_week > l["max_doses_per_week"] + 1e-9:
                alerts.append(_alert(f"dose-week-{idx}", "dose", "critical", f"Dosing Frequency Error: {label}",
                                     f"{label} is prescribed {est.doses_per_week:g} times per week; the limit for this indication is {l['max_doses_per_week']:g} per week. {l['note'] or ''}".strip(),
                                     "Confirm the intended frequency before signing.", l["source"], name, **_p(l), limit=l["max_doses_per_week"]))
            if l["max_single_mg"] is not None and est.single_mg is not None and est.single_mg > l["max_single_mg"] + 1e-9:
                over = est.single_mg / l["max_single_mg"]
                alerts.append(_alert(f"dose-single-{idx}", "dose", "critical" if over >= 2 else "warning", f"Single Dose Above Usual Maximum: {label}",
                                     f"{est.single_mg:g} mg per dose exceeds the usual maximum single dose of {l['max_single_mg']:g} mg.{ass} {l['note'] or ''}".strip(),
                                     "Check the strength and number of units, or document the clinical reason.", l["source"], name,
                                     **_p(l), estimated_mg=est.single_mg, limit_mg=l["max_single_mg"]))
            if l["max_daily_mg"] is not None and est.daily_mg is not None and est.daily_mg > l["max_daily_mg"] + 1e-9:
                over = est.daily_mg / l["max_daily_mg"]
                alerts.append(_alert(f"dose-daily-{idx}", "dose", "critical" if over >= 2 else "warning", f"Daily Dose Above Usual Maximum: {label}",
                                     f"Estimated {est.daily_mg:g} mg/day exceeds the usual maximum of {l['max_daily_mg']:g} mg/day.{ass} {l['note'] or ''}".strip(),
                                     "Reduce the dose or frequency, or document the clinical reason. Other products containing the same ingredient add to this total.",
                                     l["source"], name, **_p(l), estimated_mg=est.daily_mg, limit_mg=l["max_daily_mg"]))
            if l["max_mg_per_kg_day"] is not None and est.daily_mg is not None:
                if not ctx.weight_kg:
                    notes.add(f"{name}: weight-based dose not checked (weight missing)")
                else:
                    per_kg = est.daily_mg / ctx.weight_kg
                    if per_kg > l["max_mg_per_kg_day"] + 1e-9:
                        alerts.append(_alert(f"dose-kg-{idx}", "dose", "critical" if per_kg / l["max_mg_per_kg_day"] >= 2 else "warning",
                                             f"Weight-Based Dose Above Maximum: {label}",
                                             f"Estimated {per_kg:.1f} mg/kg/day for {ctx.weight_kg:g} kg exceeds the usual maximum of {l['max_mg_per_kg_day']:g} mg/kg/day.{ass}",
                                             "Recalculate the dose for the child's weight.", l["source"], name, **_p(l),
                                             estimated_mg_per_kg=round(per_kg, 1), limit_mg_per_kg=l["max_mg_per_kg_day"]))
    return alerts


# ---- pregnancy / lactation ------------------------------------------------------------------------------

def reproductive(kb: KnowledgeBase, ctx, lines, existing_pregnancy_items, notes):
    alerts = []
    contexts = []
    if ctx.pregnant:
        contexts.append("pregnancy")
    if ctx.lactating:
        contexts.append("lactation")
    childbearing_unknown = ctx.sex == "female" and ctx.pregnant is None and ctx.age_years is not None and 12 <= ctx.age_years <= 50
    unknown_flagged = set()
    for idx, item, res, ing in lines:
        for r in kb.repro:
            if not (r["moieties"] & ing):
                continue
            if r["context"] in contexts:
                if r["context"] == "pregnancy" and idx in existing_pregnancy_items:
                    continue  # a specific rule already covers this drug
                title = "Pregnancy Safety Alert" if r["context"] == "pregnancy" else "Breastfeeding Safety Alert"
                alerts.append(_alert(f"repro-{r['id']}-{idx}", r["context"], r["severity"], f"{title}: {r['label']}", r["message"],
                                     r["recommendation"] or "", r["source"], item["name"], **_p(r)))
            elif r["context"] == "pregnancy" and childbearing_unknown and r["severity"] == "critical" and idx not in unknown_flagged:
                unknown_flagged.add(idx)
                alerts.append(_alert(f"repro-unknown-{idx}", "pregnancy", "info", "Pregnancy Status Not Recorded",
                                     f"'{item['name']}' is harmful in pregnancy and the patient may be of childbearing age, but pregnancy status is not recorded.",
                                     "Confirm pregnancy status before prescribing.", r["source"], item["name"], **_p(r)))
                notes.add(f"{item['name']}: pregnancy status unknown")
    return alerts


# ---- antibiotic stewardship policy + hospital formulary -------------------------------------------------

def policy_and_formulary(cur, kb: KnowledgeBase, hospital_id, lines, stewardship_items):
    alerts = []
    moieties = sorted({m for _, _, _, ing in lines for m in ing})
    if not moieties:
        return alerts
    hospital_policy, formulary = {}, {}
    cur.execute("""SELECT moiety_identifier, tier, restricted_to, requires_justification, message, source, status
                   FROM smartrx.antibiotic_policy WHERE hospital_id = %s AND moiety_identifier = ANY(%s)""", (hospital_id, moieties))
    for m, tier, restricted_to, needs, message, source, status in cur.fetchall():
        hospital_policy[m] = {"tier": tier, "restricted_to": restricted_to, "requires_justification": needs, "message": message,
                              "source": source or "Hospital antibiotic policy", "status": status}
    cur.execute("""SELECT moiety_identifier, status, note, alternative FROM smartrx.hospital_formulary
                   WHERE hospital_id = %s AND moiety_identifier = ANY(%s)""", (hospital_id, moieties))
    for m, status, note, alt in cur.fetchall():
        formulary[m] = (status, note, alt)

    for idx, item, res, ing in lines:
        name = item["name"]
        for m in sorted(ing):
            pol = hospital_policy.get(m) or kb.policy.get(m)
            if pol and pol["tier"] == "reserve" and idx not in stewardship_items:
                where = f" Restricted to: {pol['restricted_to']}." if pol["restricted_to"] else ""
                just = " A documented justification is required." if pol["requires_justification"] else ""
                alerts.append(_alert(f"policy-{m}-{idx}", "stewardship", "warning", f"Reserve Antibiotic: {kb.moiety_label(m)}",
                                     (pol["message"] or f"{kb.moiety_label(m)} is a Reserve-tier antibiotic.") + where + just,
                                     "Confirm indication and culture/sensitivity support, or choose an Access/Watch alternative.",
                                     pol["source"] or "Antibiotic stewardship policy", name, **_p(pol), tier=pol["tier"]))
            f = formulary.get(m)
            if f and f[0] in ("non_formulary", "restricted"):
                status, note, alt = f
                alerts.append(_alert(f"formulary-{m}-{idx}", "formulary", "info" if status == "non_formulary" else "warning",
                                     ("Non-Formulary Medicine" if status == "non_formulary" else "Restricted Formulary Medicine") + f": {kb.moiety_label(m)}",
                                     (note or f"{kb.moiety_label(m)} is {'not on' if status == 'non_formulary' else 'restricted in'} this hospital's formulary."),
                                     (f"Consider: {alt}" if alt else "Check availability or approval requirements with the pharmacy."),
                                     "Hospital formulary", name))
    return alerts
