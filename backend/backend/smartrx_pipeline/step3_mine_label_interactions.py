"""Mine interaction CANDIDATES from the product-label text in GenericMaster ("Interaction with Drugs").

    cd backend/backend
    python smartrx_pipeline/step3_mine_label_interactions.py

Writes smartrx_data/interaction_label_candidates.csv. Every row is `draft`, severity `info`, and carries the label
sentence it came from. Nothing here is a clinical judgement: a drug name appearing in a label sentence only means
"the label mentions it". A clinician promotes rows by editing `status`/`severity` in the CSV (the CSV is the source of
truth; the ingest reloads it). Negated sentences ("no interaction with ...") are skipped.
"""
import csv
import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.smartrx.config import DATA_DIR  # noqa: E402
from modules.smartrx.textnorm import build_moiety_map, name_key, normalize_text  # noqa: E402

NEGATION = re.compile(r"\b(no|not|without|never)\b[^.;]{0,50}\b(interact|interaction|effect)", re.I)
SOURCE = "Product label text (DISB/CDSCO via GenericMaster); unreviewed mention, not a clinical judgement"
MIN_NAME_LEN = 5
# Names that are also ordinary words in label prose; a mention of these is not evidence of a drug interaction.
STOPWORDS = {"water", "alcohol", "caffeine", "iron", "calcium", "sodium", "potassium", "zinc", "magnesium", "insulin", "glucose",
             "oxygen", "vitamin", "starch", "sugar", "lactose", "ethanol", "glycerin", "glycerol", "heparin", "protein", "acid"}


def main():
    subs = list(csv.DictReader(open(DATA_DIR / "SubstanceMaster.txt", encoding="utf-8", errors="ignore"), delimiter="\t"))
    id_to_moiety, rep = build_moiety_map((r["Identifier"].strip(), r["Substance Name"].strip()) for r in subs if r.get("Identifier") and r.get("Substance Name"))
    names = {r["Identifier"].strip(): r["Substance Name"].strip() for r in subs if r.get("Identifier")}
    moiety_name = {m: names[m] for m in set(id_to_moiety.values())}

    class_alias = {}
    for r in csv.DictReader(open(DATA_DIR / "drug_classes.csv", encoding="utf-8")):
        for a in [r["class_name"].lower()] + [x for x in r["aliases"].lower().split("|") if x]:
            if len(a) >= 4:
                class_alias[normalize_text(a)] = r["class_code"]

    out, seen = [], set()
    for g in csv.DictReader(open(DATA_DIR / "GenericMaster.txt", encoding="utf-8", errors="ignore"), delimiter="\t"):
        text = (g.get("Interaction with Drugs") or "").strip()
        if not text:
            continue
        own = {id_to_moiety.get(s, s) for s in (g.get("Substance Identifier") or "").split("+") if s}
        if len(own) != 1:
            continue  # combination products: the label text cannot be attributed to one ingredient
        a = next(iter(own))
        if a not in moiety_name:
            continue
        for sentence in re.split(r"(?<=[.;])\s+", text):
            if NEGATION.search(sentence):
                continue
            tokens = normalize_text(sentence).split()
            for n in (3, 2, 1):
                for i in range(len(tokens) - n + 1):
                    phrase = " ".join(tokens[i:i + n])
                    kind = ref = None
                    if phrase in class_alias:
                        kind, ref = "class", class_alias[phrase]
                    else:
                        m = rep.get(name_key(phrase))
                        if m and m != a and m in moiety_name and len(moiety_name[m]) >= MIN_NAME_LEN and phrase not in STOPWORDS \
                                and moiety_name[m].lower() not in STOPWORDS:
                            kind, ref = "substance", moiety_name[m]
                    if not kind or (kind, ref) in {("substance", moiety_name[a])}:
                        continue
                    key = (moiety_name[a].lower(), kind, ref.lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(["substance", moiety_name[a], kind, ref, "info", "", f"The product label for {moiety_name[a]} mentions an interaction with {ref if kind == 'substance' else ref.replace('_', ' ').title()}.",
                                "Review the product label before prescribing together.", SOURCE, "draft", sentence.strip()[:400]])
    out.sort(key=lambda r: (r[1].lower(), r[3].lower()))
    path = DATA_DIR / "interaction_label_candidates.csv"
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["a_kind", "a", "b_kind", "b", "severity", "mechanism", "message", "recommendation", "source", "status", "excerpt"])
        w.writerows(out)
    print(f"{len(out)} candidate pairs written to {path}")


if __name__ == "__main__":
    main()
