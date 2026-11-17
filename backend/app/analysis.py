"""Local, equal-weight phrase selection. AI cannot determine availability or price."""
import unicodedata
from .models import Analysis,Unit
from .rewards import draw_offers
from .segmentation import split_phrases,is_stakeable_phrase
from .gemini import GenerationError

BETTING_MODE='count-v1'


def is_gap(text):
    return all(c.isspace() or unicodedata.category(c).startswith(('P','Z')) for c in text)


def build_analysis(text: str,version: int) -> Analysis:
    cursor=0
    units=[]
    for i,surface in enumerate(split_phrases(text)):
        units.append(Unit(id=f'v{version}-u{i+1}',text=surface,start=cursor,end=cursor+len(surface),stakeable=not is_gap(surface) and is_stakeable_phrase(surface)))
        cursor+=len(surface)
    if ''.join(u.text for u in units)!=text:
        raise GenerationError('本文とコマの対応を確認できませんでした。')
    if not any(u.stakeable for u in units):
        raise GenerationError('次に賭けることばが残っていないため、本文を保護しました。')
    return Analysis(units=units)


def make_offers(analysis: dict,round_number: int,version: int):
    available=sum(u['stakeable'] for u in analysis['units'])
    if not available:
        raise GenerationError('賭けられるコマがありません。')
    phase=min(3,(round_number-1)//2+1)
    return draw_offers(available,phase,version)


def validate_stakes(analysis: dict,unit_ids: list[str],required_count: int):
    if len(unit_ids)!=len(set(unit_ids)):
        raise ValueError('同じコマを二重に選択できません。')
    lookup={u['id']:u for u in analysis['units']}
    if any(i not in lookup for i in unit_ids):
        raise ValueError('本文が更新されています。コマを選び直してください。')
    units=sorted((lookup[i] for i in unit_ids),key=lambda u:u['start'])
    end=-1
    for unit in units:
        if not unit['stakeable'] or unit['start']<end:
            raise ValueError('枠のないことばや重なる範囲は賭けられません。')
        end=unit['end']
    if len(units)!=required_count:
        raise ValueError(f'ことばをちょうど{required_count}個選んでください。')
    # Different positions count separately even if they refer to the same person.
    # The later semantic resolver merges duplicate meanings without changing the count.
    return units
