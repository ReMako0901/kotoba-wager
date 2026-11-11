"""Cashless game outcomes and complete presentation plans, fixed before generation."""
import secrets

GAMES = [
    {'id': 'slot', 'name': 'スロット', 'win_probability': .5,
     'description': 'ベル1・スイカ2・REG4・BIG8。負けは2。',
     'detail': '勝利時 ベル65% / スイカ25% / REG5% / BIG5%'},
    {'id': 'blackjack', 'name': 'ブラックジャック', 'win_probability': .6,
     'description': '勝ちも負けも変化1。カードをめくる簡易進行。',
     'detail': '両者とも17以上まで自動で引く。引き分けの配列は使用しない。'},
    {'id': 'baccarat', 'name': 'バカラ', 'win_probability': .45,
     'description': 'プレイヤー側で勝負。点差が大きいほど極端に変わる。',
     'detail': '決着時の勝率45%。各配りで5%はタイで配り直し。点差9→強さ10、7〜8→9、4〜6→2、1〜3→1。'},
]


def deck(rng):
    cards = [{'rank': rank, 'suit': suit} for suit in ('♠', '♥', '♦', '♣')
             for rank in ('A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K')]
    rng.shuffle(cards)
    return cards


def card_value(card):
    rank = card['rank']
    return 1 if rank == 'A' else 10 if rank in ('10', 'J', 'Q', 'K') else int(rank)


def blackjack_total(cards):
    total = sum(card_value(card) for card in cards)
    return total + 10 if any(card['rank'] == 'A' for card in cards) and total + 10 <= 21 else total


def deal_blackjack(cards):
    player, banker = [cards[0], cards[2]], [cards[1], cards[3]]
    cursor = 4
    for hand in (player, banker):
        while blackjack_total(hand) < 17:
            hand.append(cards[cursor])
            cursor += 1
    p, b = blackjack_total(player), blackjack_total(banker)
    if p > 21:
        outcome = 'loss'
    elif b > 21:
        outcome = 'win'
    elif p == b:
        player_natural, banker_natural = len(player) == 2 and p == 21, len(banker) == 2 and b == 21
        outcome = 'win' if player_natural and not banker_natural else 'loss' if banker_natural and not player_natural else 'tie'
    else:
        outcome = 'win' if p > b else 'loss'
    return {'player': player, 'banker': banker, 'player_total': p, 'banker_total': b, 'outcome': outcome}


def baccarat_total(cards):
    return sum(card_value(card) % 10 for card in cards) % 10


def deal_baccarat(cards):
    player, banker = [cards[0], cards[2]], [cards[1], cards[3]]
    cursor = 4
    p, b = baccarat_total(player), baccarat_total(banker)
    if max(p, b) < 8:
        third = None
        if p <= 5:
            player.append(cards[cursor])
            third = card_value(cards[cursor]) % 10
            cursor += 1
        banker_draws = (b <= 5 if third is None else
                        b <= 2 or b == 3 and third != 8 or b == 4 and 2 <= third <= 7 or
                        b == 5 and 4 <= third <= 7 or b == 6 and 6 <= third <= 7)
        if banker_draws:
            banker.append(cards[cursor])
    p, b = baccarat_total(player), baccarat_total(banker)
    return {'player': player, 'banker': banker, 'player_total': p, 'banker_total': b,
            'outcome': 'win' if p > b else 'loss' if p < b else 'tie', 'difference': abs(p-b)}


def matching_deal(kind, outcome, rng, differences=None):
    deal = deal_blackjack if kind == 'blackjack' else deal_baccarat
    for _ in range(20000):
        cards = deck(rng)
        result = deal(cards)
        if result['outcome'] == outcome and (differences is None or result['difference'] in differences):
            return {**result, 'deck': cards}
    raise ValueError('カードの配列を準備できませんでした。もう一度開始してください。')


def make_gamble(kind, draw, rng=None):
    rng = rng or secrets.SystemRandom()
    if kind == 'slot':
        outcome = 'win' if draw(.5) else 'loss'
        if outcome == 'win':
            symbol, strength = rng.choices([('ベル', 1), ('スイカ', 2), ('REG', 4), ('BIG', 8)], [65, 25, 5, 5])[0]
            reels = [symbol] * 3
        else:
            symbol, strength = 'ハズレ', 2
            reels = rng.sample(['ベル', 'スイカ', 'REG', 'BIG'], 3)
        return {'kind': kind, 'outcome': outcome, 'strength': strength, 'label': symbol, 'reels': reels}
    if kind == 'blackjack':
        outcome = 'win' if draw(.6) else 'loss'
        return {'kind': kind, 'outcome': outcome, 'strength': 1, 'label': 'WIN' if outcome == 'win' else 'LOSE',
                'rounds': [matching_deal(kind, outcome, rng)]}
    if kind != 'baccarat':
        raise ValueError('このギャンブルは選択できません。')
    rounds = []
    # Probability of ties is geometric. All tied rounds and the decisive round
    # are constructed now, so later redeals never trigger a new settlement.
    while rng.random() < .05:
        rounds.append(matching_deal(kind, 'tie', rng, {0}))
    outcome = 'win' if draw(.45) else 'loss'
    differences, strength = rng.choices([([9], 10), ([7, 8], 9), ([4, 5, 6], 2), ([1, 2, 3], 1)], [20, 25, 25, 30])[0]
    rounds.append(matching_deal(kind, outcome, rng, set(differences)))
    return {'kind': kind, 'outcome': outcome, 'strength': strength, 'label': f"{rounds[-1]['difference']}点差",
            'rounds': rounds}
