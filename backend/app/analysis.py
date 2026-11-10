import unicodedata
from .models import Analysis, RawAnalysis, Unit
from .gemini import GenerationError


def is_gap(text):
    return all(c.isspace() or unicodedata.category(c).startswith(("P", "Z")) for c in text)


def align_analysis(text: str, raw: RawAnalysis, version: int) -> Analysis:
    """Offsets are Python Unicode code points, not UTF-16. UI renders unit.text."""
    ids = {c.id for c in raw.concepts}
    if len(ids) != len(raw.concepts):
        raise GenerationError("解析で設定IDが重複したため、適用しませんでした。")
    for c in raw.concepts:
        if c.id in c.depends_on or any(i not in ids for i in c.depends_on):
            raise GenerationError("解析の依存関係が不正なため、適用しませんでした。")
    cursor, units = 0, []

    def append(surface, score, concepts, reason, start, state="scored"):
        units.append(Unit(id=f"v{version}-u{len(units)+1}", text=surface, score=score, concept_ids=concepts, score_reason=reason, start=start, end=start+len(surface), scoring_state=state))

    for unit in raw.units:
        pos = text.find(unit.text, cursor)
        if pos < 0 or not is_gap(text[cursor:pos]):
            raise GenerationError("解析した言葉と本文が一致しませんでした。本文を保護して停止しました。")
        if pos > cursor:
            append(text[cursor:pos], 0, [], "句読点・空白", cursor, "punctuation")
        known_meaning = all(i in ids for i in unit.concept_ids)
        if len(set(unit.concept_ids)) != len(unit.concept_ids):
            raise GenerationError("一つの単位に同じ設定が重複しています。")
        # A surface without an identified loss cannot be safely staked. Keep it
        # visible but non-selectable; never invent a concept or cheap blank stake.
        concepts = unit.concept_ids if known_meaning else []
        score = unit.score if concepts else 0
        reason = unit.score_reason if known_meaning and (concepts or unit.score == 0) else "消失対象が特定されていないため選択不可"
        state = unit.scoring_state
        if not known_meaning or (unit.score > 0 and not concepts):
            state = "unresolved"
        elif score == 0 and state == "scored":
            state = "not_stakeable"
        append(unit.text, score, concepts, reason, pos, state)
        cursor = pos + len(unit.text)
    if cursor < len(text):
        if not is_gap(text[cursor:]):
            raise GenerationError("解析に本文の末尾が含まれていませんでした。")
        append(text[cursor:], 0, [], "句読点・空白", cursor, "punctuation")
    if "".join(u.text for u in units) != text:
        raise GenerationError("解析結果と本文の対応を確認できませんでした。")
    if not any(u.score > 0 for u in units):
        raise GenerationError("賭けられる言葉がありません。解析をやり直してください。")
    return Analysis(units=units, concepts=raw.concepts)


def reachable_combinations(analysis: dict, cap=30):
    """Every returned witness is feasible; same concept cannot be paid twice."""
    sums = {0: ([], set())}
    for unit in analysis["units"]:
        if unit["score"] <= 0:
            continue
        concepts = set(unit["concept_ids"])
        for total, (path, used) in list(sums.items()):
            next_total = total + unit["score"]
            if next_total <= cap and next_total not in sums and not concepts & used:
                sums[next_total] = (path+[unit["id"]], used | concepts)
    return {score: path for score, (path, _) in sums.items() if score > 0}


def make_offers(analysis: dict, round_number: int, version: int):
    combos = reachable_combinations(analysis)
    if not combos:
        raise GenerationError("成立する取引を用意できませんでした。")
    tier = min(3, (round_number-1)//2+1)
    menus = {
        1: [("ちょっと名文", "今の場面を、くすっとする比喩で彩る。", 3), ("いい感じの空気", "今の場面に気持ちのよい音や香りを加える。", 5), ("ラッキーな発見", "今の場面に、ちょっと嬉しい発見を加える。", 7)],
        2: [("うれしい知らせ", "今いる人物に、うれしい知らせが届く。", 7), ("新しい出会い", "物語に関わる人物との新しい出会いを起こす。", 10), ("まさかの正体", "今ある物や人物に、意外で楽しい正体がわかる。", 12)],
        3: [("向き合うふたり", "既存の人物同士の関係が、対話によって大きく変わる。", 12), ("失われていない人との再会", "現在も存在する人物との、待ち望んだ再会を実現する。過去に消えた人物は戻さない。", 16), ("新しい行き先", "登場人物がこれまでとは異なる生き方や目的を選び取る。", 20)],
    }
    return [{"id":f"v{version}-offer-{i}", "title":title, "description":description, "required_points":(score:=min(combos, key=lambda x:(abs(x-target),x))), "example_unit_ids":combos[score], "tier":tier} for i,(title,description,target) in enumerate(menus[tier])]


def validate_stakes(analysis: dict, unit_ids: list[str], required: int):
    if len(unit_ids) != len(set(unit_ids)):
        raise ValueError("同じ言葉を二重に選択できません。")
    lookup = {u["id"]:u for u in analysis["units"]}
    if any(i not in lookup for i in unit_ids):
        raise ValueError("本文が更新されています。言葉を選び直してください。")
    units = sorted((lookup[i] for i in unit_ids), key=lambda u:u["start"])
    seen = set()
    end = -1
    for unit in units:
        if unit["score"] <= 0 or unit["start"] < end or seen & set(unit["concept_ids"]):
            raise ValueError("選択範囲または同じ設定を二重に賭けることはできません。")
        end = unit["end"]
        seen.update(unit["concept_ids"])
    if sum(u["score"] for u in units) != required:
        raise ValueError("必要点数とぴったり一致していません。")
    # Carry the actual selected surfaces and mentions into generation. Never let
    # a free-standing concept ID silently replace what the player tapped.
    selected = []
    for c in analysis["concepts"]:
        if c["id"] in seen:
            selected.append({**c, "selected_surfaces": [u["text"] for u in units if c["id"] in u["concept_ids"]], "mentions": list(dict.fromkeys(u["text"] for u in analysis["units"] if c["id"] in u["concept_ids"]))})
    return units, selected
