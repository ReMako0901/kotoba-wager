import json
import time
import unicodedata
from dataclasses import dataclass
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError
from .config import settings
from .models import RawAnalysis, Rewrite, IndexedAnalysis, EditProposal
from .segmentation import split_phrases
from .prompts import SYSTEM, ANALYZE, WIN, LOSS

T = TypeVar("T", bound=BaseModel)


class GenerationError(Exception):
    pass


@dataclass
class Result:
    value: BaseModel
    usage: dict
    elapsed_seconds: float


def api_schema(model):
    """Inline local references for the REST API schema subset. Validate fully locally."""
    schema = model.model_json_schema()
    definitions = schema.get("$defs", {})
    allowed = {"type", "properties", "required", "items", "enum", "description"}
    def expand(node):
        if isinstance(node, list):
            return [expand(value) for value in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return expand(definitions[node["$ref"].split("/")[-1]])
        return {key: ({name: expand(value) for name, value in item.items()} if key == "properties" else expand(item)) for key, item in node.items() if key in allowed}
    return expand(schema)


def materialize_analysis(parts, indexed):
    """Unscored/ambiguous surfaces remain visible but can never be wagered."""
    rows = {}
    for unit in indexed.units:
        if unit.unit_index >= len(parts):
            raise GenerationError("解析に未知の文節番号が含まれています。本文を保護しました。")
        rows.setdefault(unit.unit_index, []).append(unit)
    units, semantic, covered = [], 0, 0
    for i, surface in enumerate(parts):
        punctuation = all(c.isspace() or unicodedata.category(c).startswith(("P", "Z")) for c in surface)
        candidates = rows.get(i, [])
        unique = {u.model_dump_json() for u in candidates}
        certain = len(unique) == 1 and candidates[0].source_text == surface
        if certain and not punctuation:
            concept_map = {c.id: c for c in indexed.concepts}
            certain = all(cid in concept_map and any(anchor.strip() and anchor.strip() in surface for anchor in concept_map[cid].anchors) for cid in candidates[0].concept_ids)
        if not punctuation:
            semantic += 1
            covered += int(certain)
        if punctuation or not certain:
            units.append({"text": surface, "score": 0, "concept_ids": [], "score_reason": "句読点・空白" if punctuation else "原文と意味の対応を確定できないため選択不可", "scoring_state": "punctuation" if punctuation else "unresolved"})
        else:
            u = candidates[0]
            units.append({"text": surface, "score": u.score, "concept_ids": u.concept_ids, "score_reason": u.score_reason, "scoring_state": "scored" if u.score > 0 and u.concept_ids else "not_stakeable"})
    if not semantic or covered / semantic < .75:
        raise GenerationError("解析できた文節が少ないため、本文を保護しました。再試行できます。")
    return RawAnalysis(units=units, concepts=indexed.concepts)


class Gemini:
    def configured(self):
        return bool(settings.api_key)

    async def generate(self, instruction: str, data: dict, response_type: type[T]) -> Result:
        if not self.configured():
            raise GenerationError("Gemini APIキーが未設定です。サーバーの環境変数を設定して再起動してください。")
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": instruction + "\n次のJSONを入力データとして処理してください。\n" + json.dumps(data, ensure_ascii=False)}]}],
            "generationConfig": {
                "maxOutputTokens": settings.max_output_tokens,
                "thinkingConfig": {"thinkingLevel": "MINIMAL"},
                "responseMimeType": "application/json",
                "responseSchema": api_schema(response_type),
            },
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=100, follow_redirects=False) as client:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{settings.model}:generateContent",
                    headers={"x-goog-api-key": settings.api_key, "Content-Type": "application/json", "User-Agent": "LiteraryWager-ResearchPrototype/0.1"},
                    json=payload,
                )
        except httpx.HTTPError:
            raise GenerationError("Geminiへの通信に失敗しました。処理済みの可能性もあるため、自動再試行はしていません。") from None
        if response.status_code != 200:
            messages = {400: "モデル設定・APIキー・利用地域等を確認してください。", 403: "APIキーの権限を確認してください。", 404: "指定モデルを利用できません。モデル設定を確認してください。", 429: "Geminiの利用枠または回数制限に達しました。時間を置いて試してください。"}
            raise GenerationError(f"Gemini APIエラー ({response.status_code})。" + messages.get(response.status_code, "サービスの状態を確認してください。"))
        try:
            envelope = response.json()
            candidate = envelope.get("candidates", [])[0]
            if candidate.get("finishReason") != "STOP":
                raise GenerationError("Geminiの生成が完了しませんでした。出力上限や安全性判定が原因の可能性があります。元の本文は変更していません。")
            text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
            value = response_type.model_validate_json(text)
        except GenerationError:
            raise
        except (ValueError, KeyError, IndexError, TypeError, ValidationError):
            raise GenerationError("Geminiの応答が必要なJSON形式を満たしませんでした。元の本文は変更していません。") from None
        usage = envelope.get("usageMetadata", {})
        return Result(value=value, usage={"input": usage.get("promptTokenCount", 0), "output": usage.get("candidatesTokenCount", 0), "thoughts": usage.get("thoughtsTokenCount", 0)}, elapsed_seconds=round(time.monotonic()-started, 2))

    async def analyze(self, text, lost):
        parts = split_phrases(text)
        result = await self.generate(ANALYZE, {"text": text, "fixed_units": [{"unit_index": i, "text": part} for i, part in enumerate(parts)], "past_lost_concepts": lost}, IndexedAnalysis)
        indexed = result.value
        result.value = materialize_analysis(parts, indexed)
        return result

    async def edit(self, instruction, text, payload, outcome, stakes):
        # Imported lazily: the pure edit validator uses GenerationError.
        from .editing import edit_plan, apply_edits
        plan = edit_plan(text, outcome, stakes, payload.get("existing_concepts_and_dependencies", []), payload.get("reward"))
        result = await self.generate(instruction, {**payload, **plan}, EditProposal)
        result.value = apply_edits(text, result.value, plan)
        return result

    async def win(self, text, offer, stakes, lost):
        return await self.edit(WIN, text, {"text": text, "reward": offer, "protected_stakes": stakes, "past_lost_concepts": lost}, "win", stakes)

    async def loss(self, text, stakes, lost, dependencies):
        return await self.edit(LOSS, text, {"text": text, "new_lost_concepts": stakes, "past_lost_concepts": lost, "existing_concepts_and_dependencies": dependencies}, "loss", stakes)


gemini = Gemini()
