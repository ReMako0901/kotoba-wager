"""Internal generation inspection only; unrelated to stakes or rewards."""

REVIEW_FULL_SCORE = 100
REVIEW_REJECTION_THRESHOLD = 20  # Reject strictly above this deduction total.
REVIEW_DEDUCTIONS = {
    'lost_reference': ('喪失への言及残り', 30),
    'setting_conflict': ('設定の矛盾', 20),
    'style_shift': ('時制・視点・文体の切り替わり', 10),
    'broken_connection': ('つながりの破綻・指示語の宙吊り', 20),
    'outcome_conflict': ('勝敗結果との食い違い', 30),
}


def evaluate_review(findings):
    deductions = [
        {'item': key, 'label': label, 'points': points, 'reason': getattr(findings, key).reason}
        for key, (label, points) in REVIEW_DEDUCTIONS.items()
        if getattr(findings, key).present
    ]
    total = sum(item['points'] for item in deductions)
    return total, deductions
