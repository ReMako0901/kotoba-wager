"""Game plans and outcomes used before story generation."""
import secrets

GAMES = [
    {'id': 'rps', 'name': 'じゃんけん', 'tier': 'beginner', 'win_probability': .33,
     'description': '手を選ぶ。あいこならもう一回。'},
    {'id': 'card_guess', 'name': 'カード当て', 'tier': 'beginner', 'win_probability': 1 / 3,
     'description': '高速で混ざる3枚から当たりを追う。'},
    {'id': 'dice', 'name': '一発サイコロ', 'tier': 'beginner', 'win_probability': .5,
     'description': '4〜6で勝ち。1と6は大きく変わる。'},
    {'id': 'slot', 'name': 'スロット', 'win_probability': .5,
     'description': '7が揃うと！？'},
    {'id': 'blackjack', 'name': 'ブラックジャック', 'win_probability': .6,
     'description': '堅実に勝負！'},
    {'id': 'baccarat', 'name': 'バカラ', 'win_probability': .45,
     'description': 'ハイリスクハイリターン！'},
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


def blackjack_outcome(player, dealer):
    p, d = blackjack_total(player), blackjack_total(dealer)
    if p > 21:
        return 'loss'
    p_natural = len(player) == 2 and p == 21
    d_natural = len(dealer) == 2 and d == 21
    if p_natural != d_natural:
        return 'win' if p_natural else 'loss'
    return 'win' if d > 21 or p > d else 'loss' if p < d else 'tie'


def deal_blackjack(cards):
    player, opening_dealer = [cards[0], cards[2]], [cards[1], cards[3]]
    natural = 21 in (blackjack_total(player), blackjack_total(opening_dealer))
    cursor = 4
    dealer_hands = []
    while True:
        points = blackjack_total(player)
        dealer = opening_dealer.copy()
        if not natural and points <= 21:
            for card in cards[cursor:]:
                if blackjack_total(dealer) >= 17:
                    break
                dealer.append(card)
        dealer_hands.append(dealer)
        if natural or points >= 21 or cursor == len(cards):
            break
        player.append(cards[cursor])
        cursor += 1
    return {'player': player, 'banker': dealer, 'dealer_hands': dealer_hands,
            'player_total': points, 'banker_total': blackjack_total(dealer),
            'outcome': blackjack_outcome(player, dealer)}


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
    # Naturals easily pass the fixed-outcome filter, but leave no turn for HIT.
    natural_round = kind == 'blackjack' and rng.randrange(10) == 0
    for _ in range(20000):
        cards = deck(rng)
        result = deal(cards)
        if result['outcome'] != outcome or (differences is not None and result['difference'] not in differences):
            continue
        if kind == 'blackjack':
            if (len(result['player']) == 2) != natural_round:
                continue
            if any(
                blackjack_outcome(result['player'][:2 + hits], dealer) != outcome
                for hits, dealer in enumerate(result['dealer_hands'])
            ):
                continue
        return {**result, 'deck': cards}
    raise ValueError('カードの配列を準備できませんでした。もう一度開始してください。')


BEGINNER_GAMES = {'rps', 'card_guess', 'dice'}


def prepare_beginner_game(kind, rng):
    game = {'kind': kind, 'outcome': None, 'rounds': [], 'moves': []}
    if kind == 'card_guess':
        pairs = [(0, 1), (1, 2), (0, 2)]
        swaps = []
        for _ in range(8):
            swaps.append(rng.choice([pair for pair in pairs if not swaps or pair != swaps[-1]]))
        game.update(cards=deck(rng)[:3], target=rng.randrange(3), swaps=swaps)
    return game


def play_beginner_game(game, choice, rng=None):
    rng = rng or secrets.SystemRandom()
    kind = game['kind']
    if kind == 'dice':
        if choice is not None:
            raise ValueError('サイコロには選択肢がありません。')
        face = rng.randrange(1, 7)
        outcome = 'win' if face >= 4 else 'loss'
        strength = 8 if face in (1, 6) else 1
        move = {'face': face, 'outcome': outcome}
    elif choice not in (0, 1, 2):
        raise ValueError('三つの中から選んでください。')
    elif kind == 'rps':
        roll = rng.randrange(100)
        outcome = 'win' if roll < 33 else 'loss' if roll < 66 else 'tie'
        opponent = (choice + {'win': -1, 'loss': 1, 'tie': 0}[outcome]) % 3
        strength = 2
        move = {'choice': choice, 'opponent': opponent, 'outcome': outcome}
    else:
        order = list(range(3))
        for left, right in game['swaps']:
            order[left], order[right] = order[right], order[left]
        answer = order.index(game['target'])
        outcome = 'win' if choice == answer else 'loss'
        strength = 3 if outcome == 'win' else 4
        move = {'choice': choice, 'answer': answer, 'outcome': outcome}
    game['moves'].append(move)
    if outcome != 'tie':
        game.update(outcome=outcome, strength=strength, label='WIN' if outcome == 'win' else 'LOSE')



def make_gamble(kind, draw, rng=None):
    rng = rng or secrets.SystemRandom()
    if kind in BEGINNER_GAMES:
        return prepare_beginner_game(kind, rng)
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
