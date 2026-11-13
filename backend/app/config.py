import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT / ".env")


class Settings:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    model = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
    max_output_tokens = min(int(os.environ.get("GEMINI_MAX_OUTPUT_TOKENS", "8192")), 16384)
    win_probability = float(os.environ.get("WIN_PROBABILITY", "0.5"))
    data_dir = Path(os.environ.get("STORY_DATA_DIR", str(PROJECT / "data" / "runtime")))
    storage_backend = os.environ.get("STORAGE_BACKEND", "file")
    firestore_project = os.environ.get("FIRESTORE_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "kotoba-wager"
    generation_tasks_mode = os.environ.get("GENERATION_TASKS_MODE", "inline")
    tasks_project = os.environ.get("CLOUD_TASKS_PROJECT", "kotoba-wager")
    tasks_location = os.environ.get("CLOUD_TASKS_LOCATION", "asia-northeast1")
    tasks_queue = os.environ.get("CLOUD_TASKS_QUEUE", "generation")
    tasks_target_url = os.environ.get("TASKS_TARGET_URL", "").rstrip("/")
    tasks_service_account = os.environ.get("TASKS_SERVICE_ACCOUNT", "108927229642-compute@developer.gserviceaccount.com")
    max_attempts = 3
    allowed_origins = [s.strip() for s in os.environ.get("ALLOWED_ORIGINS", "").split(",") if s.strip()]
    daily_call_limit = int(os.environ.get("GEMINI_DAILY_CALL_LIMIT", "0"))


settings = Settings()
if not 0 <= settings.win_probability <= 1:
    raise ValueError("WIN_PROBABILITY must be between 0 and 1")

if settings.storage_backend not in ("file", "firestore"):
    raise ValueError("STORAGE_BACKEND must be file or firestore")
if settings.generation_tasks_mode not in ("inline", "cloud"):
    raise ValueError("GENERATION_TASKS_MODE must be inline or cloud")
if settings.generation_tasks_mode == "cloud" and settings.storage_backend != "firestore":
    raise ValueError("Cloud Tasks requires STORAGE_BACKEND=firestore")
