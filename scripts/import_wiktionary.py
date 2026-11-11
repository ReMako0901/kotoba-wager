"""Extract a small, reproducible server-side headword index from jawiktionary JSONL.gz."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re

from sudachipy import Dictionary, SplitMode

SOURCE = 'https://kaikki.org/jawiktionary/rawdata.html'
JAPANESE = re.compile(r'[ぁ-ゖァ-ヺ一-龯々〆ー]+\Z')
KANJI = re.compile(r'[一-龯々〆]')
MAX_LENGTH = 12


def kind_for(entry: dict) -> str | None:
    if entry.get('lang_code') != 'ja':
        return None
    word = entry.get('word', '')
    if not (3 <= len(word) <= MAX_LENGTH and JAPANESE.fullmatch(word) and KANJI.search(word)):
        return None
    if entry.get('pos') in {'noun', 'adj_noun'}:
        return 'noun'
    if entry.get('pos') == 'phrase' and (
        'idiomatic' in entry.get('tags', [])
        or any(c.endswith('慣用句') for c in entry.get('categories', []))
        or any('idiomatic' in s.get('tags', []) for s in entry.get('senses', []))
    ):
        return 'idiom'
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--dump-date', required=True, help='Wiktionary dump date from the Kaikki source page')
    args = parser.parse_args()
    with args.source.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    tok = Dictionary().tokenizer()
    entries: dict[str, str] = {}
    with gzip.open(args.source, 'rt', encoding='utf-8') as f:
        for line in f:
            row = json.loads(line)
            kind = kind_for(row)
            if kind is None:
                continue
            word = row['word']
            # Keep only useful boundary repairs, not the entire general dictionary.
            if len(tok.tokenize(word, SplitMode.C)) < 2:
                continue
            if word not in entries or kind == 'noun':
                entries[word] = kind
    if not entries:
        raise ValueError('No usable Japanese entries extracted; check the input dataset and schema.')
    output = {
        'version': 1,
        'source': {'url': SOURCE, 'dump_date': args.dump_date, 'sha256_gzip': digest},
        'entries': dict(sorted(entries.items())),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'{len(entries)} headwords; {args.output.stat().st_size} bytes; source sha256={digest}')


if __name__ == '__main__':
    main()
