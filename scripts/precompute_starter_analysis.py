"""Generate the first-round units for the starter catalog without network calls."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.analysis import build_analysis
from app.starter_stories import CATALOG_PATH, PRECOMPUTED_PATH, analysis_fingerprint


def main():
    stories = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    analyses = {}
    for story in stories:
        story_id = story["id"]
        if story_id in analyses:
            raise ValueError(f"Duplicate starter ID: {story_id}")
        analysis = build_analysis(story["text"], 1)
        if sum(unit.stakeable for unit in analysis.units) < 3:
            raise ValueError(f"Starter has fewer than three selectable units: {story_id}")
        analyses[story_id] = analysis.model_dump()

    lines = [
        f'  "fingerprint": {json.dumps(analysis_fingerprint())},',
        '  "analyses": {',
        ",\n".join(
            f"    {json.dumps(story_id)}: {json.dumps(analysis, ensure_ascii=False)}"
            for story_id, analysis in analyses.items()
        ),
        "  }",
    ]
    PRECOMPUTED_PATH.write_text("{\n" + "\n".join(lines) + "\n}\n", encoding="utf-8")
    print(f"Generated first-round units for {len(analyses)} starters.")


if __name__ == "__main__":
    main()
