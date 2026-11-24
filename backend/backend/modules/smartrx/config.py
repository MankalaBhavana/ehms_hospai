"""SmartRx runtime configuration. Everything environment-specific lives here."""
import os
from pathlib import Path

ENGINE_VERSION = "1.1.0"

_BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Directory holding the staged knowledge files (BrandMaster.txt, clinical_rules.csv, ...).
DATA_DIR = Path(os.getenv("SMARTRX_DATA_DIR") or (_BACKEND_ROOT / "smartrx_data"))
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

# Labs older than this are still used but reported as stale.
LAB_STALE_DAYS = int(os.getenv("SMARTRX_LAB_STALE_DAYS", "90"))
# Fuzzy name matches below this similarity are never trusted as a resolution.
FUZZY_MIN_RATIO = float(os.getenv("SMARTRX_FUZZY_MIN_RATIO", "0.86"))
MAX_ITEMS_PER_EVALUATION = int(os.getenv("SMARTRX_MAX_ITEMS", "60"))
RULE_CACHE_SECONDS = int(os.getenv("SMARTRX_RULE_CACHE_SECONDS", "60"))

# Rules and classes in these statuses are loaded by the engine. Set
# SMARTRX_INCLUDE_DRAFT=true for shadow-mode review; alerts built from draft
# knowledge are always labelled ``knowledge_status: draft``.
INCLUDE_DRAFT = os.getenv("SMARTRX_INCLUDE_DRAFT", "false").strip().lower() in ("1", "true", "yes")
ACTIVE_STATUSES = ("approved", "draft") if INCLUDE_DRAFT else ("approved",)

# Medicines already prescribed in this window count as "current" for interaction checks (no duration data exists).
ACTIVE_MED_DAYS = int(os.getenv("SMARTRX_ACTIVE_MED_DAYS", "14"))
MAX_CURRENT_MEDS = 25

# Register of guideline documents; `verified` knowledge must cite a source_id found here.
KNOWLEDGE_ROOT = Path(os.getenv("SMARTRX_KNOWLEDGE_ROOT") or (Path(__file__).resolve().parents[4] / "HospAI_Clinical_Knowledge"))
SOURCE_LOG = Path(os.getenv("SMARTRX_SOURCE_LOG") or (KNOWLEDGE_ROOT / "Source_Log.csv"))
# Development/test switch only: lets `unsourced` rows load. In any real deployment leave this unset.
ALLOW_UNSOURCED = os.getenv("SMARTRX_ALLOW_UNSOURCED", "false").strip().lower() in ("1", "true", "yes")
