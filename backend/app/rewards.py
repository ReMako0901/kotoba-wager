"""Reward pools by round tier, exact chip count, and editing family."""
import secrets


LEGACY_REWARDS = {
    1: [('ちょっと名文', '今の場面を、くすっとする短い比喩で彩る。'),
        ('ラッキーな発見', '登場人物が、ちょっと嬉しいものや手がかりを発見する。'),
        ('まさかの出来事', '今の場面から、意外で楽しい新展開を起こす。')],
    2: [('いい感じの空気', '今ある風景の音や香りの描写を深める。'),
        ('うれしい知らせ', '今いる人物に、うれしい知らせが届く。'),
        ('新しい出会い', '物語に関わる新たな人物との出会いを起こす。')],
    3: [('ひとことの魔法', '今の場面を彩る、印象的な短い表現を加える。'),
        ('まさかの正体', '今ある物や人物の、楽しい秘密が一つ明らかになる。'),
        ('新しい行き先', '登場人物が異なる目的や生き方へ踏み出す展開を起こす。')],
}

# Both axes enlarge the proposed scope; gamble strength still controls the edit budget.
SCOPES = {
    1: ['目の前の一瞬', '今の場面', 'この場面の次'],
    2: ['今の場面', 'この場面の次', '登場人物の次の一歩'],
    3: ['この場面の次', '登場人物の次の一歩', '物語の行く先'],
}


def build_pools():
    pools = {}
    for tier, scopes in SCOPES.items():
        for count, scope in enumerate(scopes, 1):
            families = {
                'expression': [
                    ('鮮やかな比喩', f'{scope}を支える既存の描写を、鮮やかな比喩で深める。'),
                    ('心の声', f'{scope}について、今いる人物の気持ちを掘り下げる。'),
                ],
                'plot': [
                    ('次の場面へ', f'{scope}につながる時間の経過を一つ加え、次へ進める。'),
                    ('新しい場所', f'{scope}につながる新しい場所を一つ示し、そこへ踏み出す。'),
                    ('誰かの約束・目的', f'{scope}につながる約束か目的を一つ生み、行動を始める。'),
                    ('関係の変化', f'{scope}につながる人物同士の関係の変化を一つ起こす。'),
                    ('小さな危機の接近', f'{scope}につながる小さな危機を一つ示し、乗り越える一歩を描く。'),
                ],
            }
            families['expression' if count == 1 else 'plot'].insert(0, LEGACY_REWARDS[tier][count - 1])
            pools[tier, count] = families
    return pools


REWARD_POOLS = build_pools()


def draw_offers(available, tier, version):
    counts = list(range(1, min(3, available) + 1))
    # Guarantee a plot reward even when only the one-chip cell is affordable.
    plot_count = secrets.choice(counts)
    offers = []
    for count in counts:
        family = 'plot' if count == plot_count else secrets.choice(('expression', 'plot'))
        title, description = secrets.choice(REWARD_POOLS[tier, count][family])
        offers.append({'id': f'v{version}-offer-{count-1}', 'title': title,
                       'description': description, 'family': family,
                       'required_count': count, 'change_scale': count, 'tier': tier})
    return offers


def reward_policy(offer):
    # Old saved offers keep their identity; infer only the missing editing family.
    family = offer.get('family')
    if family is None:
        family = 'expression' if offer.get('title') in {row[0][0] for row in LEGACY_REWARDS.values()} else 'plot'
    if family == 'expression':
        return '表現系：新しい要素を足さず、既存要素の描写を深める。強さは描写の深さや感情に反映し、新しい人物・場所・出来事を加えない。'
    return '展開系：新しい要素を1つ追加し、物語を前へ進める。追加要素をきっかけとする行動や変化まで描き、強さに応じて規模を調整する。'
