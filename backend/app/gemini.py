import json
import time
from dataclasses import dataclass
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError
from .config import settings
from .models import EditProposal, MeaningResponse, StakesResolution, ResolvedConcept, StoryReview
from .prompts import SYSTEM, RESOLVE, WIN, LOSS, REVIEW

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


def materialize_meanings(text, units, response):
    lookup={u['id']:u for u in units}
    rows={}
    for meaning in response.meanings:
        if meaning.unit_id not in lookup or meaning.unit_id in rows:
            raise GenerationError('選択したことばと意味の対応を確認できませんでした。勝敗と本文は保護されています。')
        if meaning.source_text!=lookup[meaning.unit_id]['text']:
            raise GenerationError('選んだ原文とAIの解釈が一致しませんでした。勝敗と本文は保護されています。')
        if any(not m.strip() or m not in text for m in meaning.mentions):
            raise GenerationError('関連する言及を原文で確認できませんでした。本文を保護しました。')
        rows[meaning.unit_id]=meaning
    if set(rows)!=set(lookup):
        raise GenerationError('選んだことばの解釈が一部ありませんでした。同じ勝敗で再試行できます。')
    groups={}
    for u in units:
        m=rows[u['id']]
        key=(m.kind,m.label.strip())
        if key not in groups:
            groups[key]=ResolvedConcept(id=u['id'],label=m.label,kind=m.kind,description=m.description,depends_on=[],anchors=[],selected_surfaces=[],mentions=[])
        c=groups[key]
        c.selected_surfaces=list(dict.fromkeys([*c.selected_surfaces,u['text']]))
        c.anchors=list(dict.fromkeys([*c.anchors,u['text']]))
        c.mentions=list(dict.fromkeys([*c.mentions,u['text'],*m.mentions]))
    return StakesResolution(concepts=list(groups.values()))


class Gemini:
    def configured(self):
        return bool(settings.api_key)

    async def generate(self, instruction: str, data: dict, response_type: type[T], *, thinking_level: str = "MINIMAL") -> Result:
        if not self.configured():
            raise GenerationError("Gemini APIキーが未設定です。サーバーの環境変数を設定して再起動してください。")
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": instruction + "\n次のJSONを入力データとして処理してください。\n" + json.dumps(data, ensure_ascii=False)}]}],
            "generationConfig": {
                "maxOutputTokens": settings.max_output_tokens,
                "thinkingConfig": {"thinkingLevel": thinking_level},
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

    async def resolve_stakes(self,text,units,lost):
        # No scoring, availability decisions or number adjustment is delegated to AI.
        result=await self.generate(RESOLVE,{'text':text,'selected_units':[{'unit_id':u['id'],'source_text':u['text']} for u in units],'past_lost_concepts':lost},MeaningResponse)
        result.value=materialize_meanings(text,units,result.value)
        return result

    async def edit(self, instruction, text, payload, outcome, stakes):
        # Imported lazily: the pure edit validator uses GenerationError.
        from .editing import edit_plan, apply_edits
        plan = edit_plan(text, outcome, stakes, payload.get("existing_concepts_and_dependencies", []), payload.get("reward"), payload.get("narrative_change"))
        result = await self.generate(instruction, {**payload, **plan}, EditProposal)
        result.value = apply_edits(text, result.value, plan)
        return result

    async def win(self, text, offer, stakes, lost):
        return await self.edit(WIN, text, {"text": text, "reward": offer, "protected_stakes": stakes, "past_lost_concepts": lost}, "win", stakes)

    async def loss(self, text, stakes, lost, dependencies, narrative_change=None):
        return await self.edit(LOSS, text, {"text": text, "new_lost_concepts": stakes, "past_lost_concepts": lost, "existing_concepts_and_dependencies": dependencies, "narrative_change": narrative_change}, "loss", stakes)

    async def review(self, original, candidate, outcome, offer, stakes, lost):
        from .editing import edit_plan, apply_edits

        plan = edit_plan(original, outcome, stakes, [], offer)
        result = await self.generate(REVIEW, {
            **plan,
            'original_text': original,
            'candidate_text': candidate.text,
            'outcome': outcome,
            'reward': offer if outcome == 'win' else None,
            'protected_stakes': stakes if outcome == 'win' else [],
            'new_lost_concepts': stakes if outcome == 'loss' else [],
            'past_lost_concepts': lost,
        }, StoryReview, thinking_level="MEDIUM")
        review = result.value
        if review.verdict == 'reject':
            raise GenerationError('文章全体の読み直しで違和感が残ったため、反映しませんでした。同じ勝敗で再試行できます。')
        if review.verdict == 'repair':
            try:
                proposal = EditProposal.model_validate(review.model_dump())
            except ValidationError:
                raise GenerationError('文章の修正案を確認できませんでした。同じ勝敗で再試行できます。') from None
            result.value = apply_edits(original, proposal, plan)
            if result.value.text == candidate.text:
                raise GenerationError('読み直しで見つかった違和感を修正できませんでした。同じ勝敗で再試行できます。')
            if outcome == 'loss' and any(
                surface not in candidate.text and surface in result.value.text
                for concept in stakes for surface in concept['selected_surfaces']
            ):
                raise GenerationError('修正案が失われたことばを戻したため、本文を保護しました。同じ勝敗で再試行できます。')
        else:
            if review.edits:
                raise GenerationError('文章の読み直し結果が矛盾しています。同じ勝敗で再試行できます。')
            result.value = candidate.model_copy(update={'checks': review.checks})
        return result


gemini = Gemini()
