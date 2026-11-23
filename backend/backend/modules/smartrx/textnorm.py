"""Name normalisation and active-moiety grouping shared by ingestion and the engine."""
import re

# Words that describe a salt, hydrate or counter-ion rather than a different active ingredient.
_STRIP = frozenset("""
hydrochloride hcl dihydrochloride monohydrate dihydrate trihydrate tetrahydrate pentahydrate hemihydrate
sesquihydrate hydrate anhydrous anhydrate sodium disodium potassium dipotassium calcium magnesium zinc
sulfate sulphate bisulfate maleate besylate besilate mesylate mesilate tartrate bitartrate succinate
phosphate fumarate citrate acetate bromide hydrobromide nitrate lactate gluconate oxalate tosylate
napsylate pamoate valerate propionate dipropionate benzoate stearate palmitate decanoate enanthate
cypionate lysine dl-lysine arginine tromethamine meglumine trometamol medoxomil axetil proxetil
etexilate fosamil benzathine procaine indanyl solvate cilexetil
""".split())

# If stripping leaves only these (or nothing), the salt word IS the identity (potassium chloride).
_AMBIGUOUS = frozenset("""
chloride bromide iodide fluoride oxide hydroxide carbonate bicarbonate phosphate nitrate sulfate sulphate
citrate acetate gluconate lactate
""".split())

_PUNCT = re.compile(r"[^\w\s+%./-]")
_SPACES = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Lower-case, strip punctuation noise, collapse whitespace."""
    cleaned = _PUNCT.sub(" ", (text or "").lower())
    return _SPACES.sub(" ", cleaned).strip()


def _tokens(name: str) -> list:
    return re.findall(r"[a-z0-9][a-z0-9-]*", (name or "").lower())


def _fold_acid_forms(tokens: list) -> frozenset:
    """'clavulanic acid' and 'clavulanate' are the same moiety: fold both to a shared stem."""
    out = set()
    for i, t in enumerate(tokens):
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        prev = tokens[i - 1] if i > 0 else None
        if t == "acid" and prev and prev.endswith("ic") and len(prev) > 4:
            continue  # consumed with the preceding '-ic'
        if t.endswith("ic") and nxt == "acid" and len(t) > 4:
            out.add(t[:-2])
        elif t.endswith("ate") and len(t) > 6 and t not in _STRIP:
            out.add(t[:-3])
        else:
            out.add(t)
    return frozenset(out)


def name_key(name: str) -> frozenset:
    """Order-insensitive key for a substance name with salt/hydrate words removed."""
    tokens = _fold_acid_forms(_tokens(name))
    key = tokens - _STRIP
    if not key or key <= _AMBIGUOUS:
        return tokens
    return key


def build_moiety_map(substances):
    """substances: iterable of (identifier, name) -> (identifier -> moiety identifier, key -> moiety identifier)."""
    groups = {}
    for ident, name in substances:
        groups.setdefault(name_key(name), []).append((ident, name))
    rep = {}
    id_to_moiety = {}
    for key, members in groups.items():
        # Prefer the record with the fewest salt words (the plain ingredient), then the shortest name, then lowest id.
        chosen = min(members, key=lambda m: (sum(t in _STRIP for t in _tokens(m[1])), len(m[1]), m[0]))
        rep[key] = chosen[0]
        for ident, _ in members:
            id_to_moiety[ident] = chosen[0]
    return id_to_moiety, rep


# Strength like "500 mg", "0.5mg", "10 mcg", "100 iu", "5 %", "250 mg/5 ml"
STRENGTH_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|gm|ml|iu|%|units?|meq)(?:\s*/\s*(\d+(?:\.\d+)?)?\s*(ml|l|g|dose|actuation))?",
    re.IGNORECASE,
)

_FORM_WORDS = frozenset("""
tab tabs tablet tablets cap caps capsule capsules inj injection syp syrup susp suspension drops drop
cream oint ointment gel lotion sachet powder solution infusion iv im sc oral
""".split())


def split_name_strength(text: str):
    """'Augmentin 625 mg tab' -> ('augmentin', ['625mg'])."""
    norm = normalize_text(text)
    strengths = [
        f"{m.group(1)}{m.group(2).lower()}" for m in STRENGTH_RE.finditer(norm)
    ]
    no_strength = STRENGTH_RE.sub(" ", norm)
    # a bare trailing number is a strength shorthand too ("augmentin 625")
    tokens = [t for t in no_strength.split() if t not in _FORM_WORDS]
    bare = [t for t in tokens if re.fullmatch(r"\d+(?:\.\d+)?", t)]   # "augmentin 625 duo" -> strength 625
    core = _SPACES.sub(" ", " ".join(t for t in tokens if t not in bare)).strip()
    return core, strengths + bare
