"""表紙に表示する賭けコマだけを生成済みの物語から取り出す。"""
import logging
import re
import unicodedata

import google.auth
from google.auth.transport.requests import Request
import httpx

from .analysis import build_analysis
from .story_generation import CONTACT, contains_contact


NG_WORDS = ('セックス', 'せっくす', 'ちんこ', 'まんこ', 'レイプ', '死ね', 'しね',
            'クズ', 'くず野郎', '馬鹿', 'バカ', 'ガイジ', 'がいじ', 'キチガイ', 'きちがい')
MAX_WORDS = 60


def normalized(value):
    return unicodedata.normalize('NFKC', value).casefold()


def blocked(value):
    value = normalized(value)
    return any(word in value for word in NG_WORDS)


def generated_records():
    credentials, project = google.auth.default(scopes=['https://www.googleapis.com/auth/datastore'])
    project = project or 'kotoba-wager'
    credentials.refresh(Request())
    url = (f'https://firestore.googleapis.com/v1/projects/{project}'
           '/databases/(default)/documents/generated_stories')
    fields = ('name', 'title', 'text', 'final_text')
    params = {'pageSize': 20, 'mask.fieldPaths': fields}
    with httpx.Client(headers={'Authorization': f'Bearer {credentials.token}'}, timeout=10) as client:
        while True:
            response = client.get(url, params=params)
            response.raise_for_status()
            page = response.json()
            for doc in page.get('documents', []):
                yield {key: doc['fields'].get(key, {}).get('stringValue', '') for key in fields}
            if not page.get('nextPageToken'):
                return
            params['pageToken'] = page['nextPageToken']


def title_words() -> list[str]:
    words = {}
    try:
        for record in generated_records():
            body = record['final_text'] or record['text']
            if not body or any(blocked(record[key]) for key in ('title', 'text', 'final_text')):
                continue
            # 正規化した本文と同じ座標で照合し、分割された名前や連絡先の断片も除く。
            folded = normalized(body)
            private = [m.span() for m in CONTACT.finditer(folded)]
            name = normalized(record['name'])
            if name:
                private.extend(m.span() for m in re.finditer(re.escape(name), folded))
            for unit in build_analysis(body, 1).units:
                if not unit.stakeable:
                    continue
                word = normalized(unit.text)
                start = len(normalized(body[:unit.start]))
                end = len(normalized(body[:unit.end]))
                if any(start < right and left < end for left, right in private):
                    continue
                if (word and not blocked(word) and not contains_contact(word)
                        and not any(c.isdigit() for c in word)):
                    words.setdefault(word, unit.text)
                    if len(words) == MAX_WORDS:
                        return list(words.values())
    except Exception:
        logging.getLogger(__name__).warning('Could not load title words')
        return []
    return list(words.values())
