"""Read first-round analysis generated from the catalog and current dictionaries."""
import hashlib
from importlib.metadata import version
import json
import logging

from pydantic import TypeAdapter, ValidationError

from . import analysis, segmentation
from .config import PROJECT
from .models import Analysis

CATALOG_PATH = PROJECT / "data" / "stories.json"
PRECOMPUTED_PATH = PROJECT / "data" / "starter_analysis.json"


def analysis_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in (
        CATALOG_PATH,
        segmentation.SELECTION_DICTIONARY_PATH,
        segmentation.EXTERNAL_LEXICON_PATH,
        PROJECT / "backend" / "app" / "segmentation.py",
        PROJECT / "backend" / "app" / "analysis.py",
    ):
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    for package in ("SudachiPy", "sudachidict-core"):
        digest.update(f"{package}=={version(package)}\n".encode())
    return digest.hexdigest()


def load_precomputed() -> dict[str, Analysis]:
    try:
        document = json.loads(PRECOMPUTED_PATH.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("fingerprint") != analysis_fingerprint():
            logging.getLogger(__name__).warning("Starter analysis is out of date. Using local segmentation.")
            return {}
        return TypeAdapter(dict[str, Analysis]).validate_python(document.get("analyses"))
    except (OSError, ValueError, ValidationError):
        logging.getLogger(__name__).warning("Starter analysis could not be loaded. Using local segmentation.")
        return {}
