"""Story progress uses committed trades and word counts only."""
import secrets
from datetime import datetime, timezone
from .config import settings


def summarize(transactions):
    committed = [tx for tx in transactions if tx['status'] == 'committed']
    gained = sum(tx.get('outcome') == 'win' for tx in committed)
    lost = sum(tx.get('wager_count', len(tx.get('unit_ids', tx.get('stakes', []))))
               for tx in committed if tx.get('outcome') == 'loss')
    return dict(rounds=len(committed), gained=gained, lost=lost, difference=gained-lost)


def update_progress(session):
    """Called under the existing session lock, before persisting the snapshot."""
    if 'story_progress' not in session:
        session['story_progress'] = {
            'required_rounds': secrets.randbelow(settings.story_rounds_max-settings.story_rounds_min+1)+settings.story_rounds_min,
            'phase': 'forced', 'reached': None, 'choices': [], 'extension_start': None,
        }
    progress = session['story_progress']
    committed = [tx for tx in session['transactions'] if tx['status'] == 'committed']
    if progress['reached'] is None and len(committed) >= progress['required_rounds']:
        progress['reached'] = summarize(committed[:progress['required_rounds']])
        progress['phase'] = 'escapable'
    if progress['phase'] == 'escapable' and session['status'] == 'ready':
        session['view'] = 'result'
    return progress


def choose_progress(session, request):
    progress = update_progress(session)
    previous = next((c for c in progress['choices'] if c['request_id'] == request.request_id), None)
    if previous:
        if previous['choice'] != request.choice or previous['version'] != request.version:
            raise ValueError('同じ選択IDで異なる内容を送信できません。')
        return
    if session['status'] != 'ready' or session['view'] != 'result' or session['version'] != request.version:
        raise ValueError('最新の結果画面で選択してください。')
    if progress['phase'] not in ('escapable', 'extension'):
        raise ValueError('現在は脱出・継続を選択できません。')
    if request.choice == 'continue' and progress['phase'] != 'escapable':
        raise ValueError('すでに延長戦に入っています。')
    totals = summarize(session['transactions'])
    progress['choices'].append(dict(request_id=request.request_id, choice=request.choice,
                                    version=request.version, totals=totals,
                                    created_at=datetime.now(timezone.utc).isoformat()))
    if request.choice == 'escape':
        progress['phase'] = 'ended'
    else:
        progress['phase'] = 'extension'
        progress['extension_start'] = totals['rounds']
    session['pending_transaction_id'] = None


def public_progress(session):
    progress = session['story_progress']
    totals = summarize(session['transactions'])
    result = {**progress, 'totals': totals,
              'extension_rounds': max(0, totals['rounds']-progress['extension_start'])
              if progress['extension_start'] is not None else 0}
    if progress['phase'] == 'forced':
        result.pop('required_rounds')
    return result
