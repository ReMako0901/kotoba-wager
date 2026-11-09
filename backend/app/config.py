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
    max_attempts = 3
    allowed_origins = [s.strip() for s in os.environ.get("ALLOWED_ORIGINS", "").split(",") if s.strip()]
    daily_call_limit = int(os.environ.get("GEMINI_DAILY_CALL_LIMIT", "0"))


settings = Settings()
if not 0 <= settings.win_probability <= 1:
    raise ValueError("WIN_PROBABILITY must be between 0 and 1")
