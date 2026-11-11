"""Stable short phrase boundaries. Morphology + simple attachment, not a dependency parser."""
import json
from pathlib import Path
from functools import lru_cache
from sudachipy import dictionary, tokenizer

# Game-specific rules are separate from Sudachi's general-purpose dictionary.
SELECTION_DICTIONARY_PATH = Path(__file__).resolve().parents[2] / 'data' / 'segmentation_dictionary.json'


def load_selection_dictionary(path: Path) -> tuple[tuple[str, ...], frozenset[str]]:
    data = json.loads(path.read_text(encoding='utf-8'))
    keys = {'version', 'fixed_compounds', 'non_wager_connectors'}
    if (not isinstance(data, dict) or set(data) != keys
            or type(data['version']) is not int or data['version'] != 1):
        raise ValueError('分割辞書の形式・バージョンが不正です。')
    for name in ('fixed_compounds', 'non_wager_connectors'):
        entries = data[name]
        if (not isinstance(entries, list)
                or any(not isinstance(s, str) or not s or any(c.isspace() for c in s) for s in entries)
                or len(entries) != len(set(entries))):
            raise ValueError(f'分割辞書の{name}には重複のない空白なし文字列を指定してください。')
    return tuple(sorted(data['fixed_compounds'], key=lambda s: (-len(s), s))), frozenset(data['non_wager_connectors'])


@lru_cache(maxsize=1)
def selection_dictionary():
    # Reload on process restart; never silently ignore an invalid dictionary.
    return load_selection_dictionary(SELECTION_DICTIONARY_PATH)


def _lexical_tokens(tokens):
    rows = [(t.surface(), t.part_of_speech(), t.dictionary_form()) for t in tokens]
    i = 0
    while i < len(rows):
        matched = False
        for compound in selection_dictionary()[0]:
            surface = ''
            j = i
            while j < len(rows) and len(surface) < len(compound):
                surface += rows[j][0]
                j += 1
            if surface == compound:
                yield surface, ('名詞', '普通名詞', 'サ変可能', '*', '*', '*'), compound
                i = j
                matched = True
                break
        if not matched:
            yield rows[i]
            i += 1


@lru_cache(maxsize=1)
def _dictionary():
    return dictionary.Dictionary()


def split_phrases(text: str) -> list[str]:
    # Tokenizers are per call; dictionary is shared (no mutable tokenizer across requests).
    tokens = _dictionary().create().tokenize(text, tokenizer.Tokenizer.SplitMode.C)
    parts: list[str] = []
    heads: list[str] = []
    previous = ('', '')
    for surface, tags, base in _lexical_tokens(tokens):
        pos = tags[0]
        # Attach particles/auxiliaries/suffixes to their content word. Leave punctuation
        # separate and preserve literal surfaces, whitespace and original offsets.
        if parts and pos in {'助詞', '助動詞', '接尾辞'} and previous[0] not in {'補助記号', '空白'}:
            parts[-1] += surface
        elif (parts and pos == '動詞' and previous[:2] == ('助詞', '接続助詞')
              and heads[-1] in {'持つ', '連れる'} and base in {'出る', 'くる', '来る', '行く', 'いく'}):
            # Carry/take-out chains only; do not absorb a following independent action.
            parts[-1] += surface
        elif parts and pos == '名詞' and surface in {'日','朝','夜'} and previous[0] == '助動詞':
            parts[-1] += surface
        elif parts and pos == '動詞' and tags[1] == '非自立可能' and (previous[0] == '動詞' or previous[:2] == ('助詞', '接続助詞') or (previous[0] in {'名詞', '形状詞'} and base == 'する')):
            parts[-1] += surface
        elif parts and previous[0] == '名詞' and pos in {'名詞', '形状詞'}:
            parts[-1] += surface
        elif parts and previous[0] in {'接頭辞', '連体詞'} and pos not in {'補助記号', '空白'}:
            parts[-1] += surface
        else:
            parts.append(surface)
            heads.append(base)
        previous = tags
    if ''.join(parts) != text:
        raise ValueError('分割後の本文が原文と一致しません。')
    return parts


def noun_literals(text: str) -> list[str]:
    """Literal entity anchors for preserving objects when only a relation is lost."""
    tokens=_dictionary().create().tokenize(text,tokenizer.Tokenizer.SplitMode.C)
    return list(dict.fromkeys(t.surface() for t in tokens if t.part_of_speech()[0]=='名詞'))


def is_stakeable_phrase(surface: str) -> bool:
    """Prototype rule: wager entities, attributes and named events/relations.

    Ordinary verbal predicates and discourse adverbs stay readable as plain text.
    This is deterministic morphology, not AI pricing or a full semantic parser.
    """
    if surface in selection_dictionary()[1]:
        return False
    tokens = _dictionary().create().tokenize(surface, tokenizer.Tokenizer.SplitMode.C)
    return any(tags[0] in {'名詞', '代名詞', '形容詞', '形状詞'}
               for _, tags, _ in _lexical_tokens(tokens))
