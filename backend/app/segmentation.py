"""Stable short phrase boundaries. Morphology + simple attachment, not a dependency parser."""
from functools import lru_cache
from sudachipy import dictionary, tokenizer

@lru_cache(maxsize=1)
def _dictionary():
    return dictionary.Dictionary()


def split_phrases(text: str) -> list[str]:
    # Tokenizers are per call; dictionary is shared (no mutable tokenizer across requests).
    tokens = _dictionary().create().tokenize(text, tokenizer.Tokenizer.SplitMode.C)
    parts: list[str] = []
    previous = ('', '')
    for token in tokens:
        surface = token.surface()
        tags = token.part_of_speech()
        pos = tags[0]
        # Attach particles/auxiliaries/suffixes to their content word. Leave punctuation
        # separate and preserve literal surfaces, whitespace and original offsets.
        if parts and pos in {'助詞', '助動詞', '接尾辞'} and previous[0] not in {'補助記号', '空白'}:
            parts[-1] += surface
        elif parts and pos == '動詞' and tags[1] == '非自立可能' and (previous[0] == '動詞' or previous[:2] == ('助詞', '接続助詞') or (previous[0] in {'名詞', '形状詞'} and token.dictionary_form() == 'する')):
            parts[-1] += surface
        elif parts and previous[0] == '名詞' and pos in {'名詞', '形状詞'}:
            parts[-1] += surface
        elif parts and previous[0] in {'接頭辞', '連体詞'} and pos not in {'補助記号', '空白'}:
            parts[-1] += surface
        else:
            parts.append(surface)
        previous = tags
    if ''.join(parts) != text:
        raise ValueError('分割後の本文が原文と一致しません。')
    return parts


def noun_literals(text: str) -> list[str]:
    """Literal entity anchors for preserving objects when only a relation is lost."""
    tokens=_dictionary().create().tokenize(text,tokenizer.Tokenizer.SplitMode.C)
    return list(dict.fromkeys(t.surface() for t in tokens if t.part_of_speech()[0]=='名詞'))
