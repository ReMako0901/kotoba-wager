"""Game plans and outcomes used before story generation."""
import secrets

GAMES = [
    {'id': 'rps', 'name': 'じゃんけん', 'tier': 'beginner', 'win_probability': .33,
     'description': '手を選ぶ。あいこならもう一回。'},
    {'id': 'card_guess', 'name': 'カード当て', 'tier': 'beginner', 'win_probability': 1 / 3,
     'description': '高速で混ざる3枚から当たりを追う。'},
    {'id': 'chinchiro', 'name': 'チンチロ', 'tier': 'beginner', 'win_probability': .5,
     'description': 'アノマと丼で勝負。役の強さで比べる。'},
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
            'outcome': 'win' if p >= b else 'loss', 'difference': abs(p-b)}


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


BEGINNER_GAMES = {'rps', 'card_guess', 'chinchiro'}


def prepare_beginner_game(kind, rng):
    game = {'kind': kind, 'outcome': None, 'rounds': [], 'moves': []}
    if kind == 'card_guess':
        pairs = [(0, 1), (1, 2), (0, 2)]
        swaps = []
        for _ in range(14):
            swaps.append(rng.choice([pair for pair in pairs if not swaps or pair != swaps[-1]]))
        ace = {'rank': 'A', 'suit': '♠'}
        cards = deck(rng)
        cards.remove(ace)
        cards = cards[:2]
        target = rng.randrange(3)
        cards.insert(target, ace)
        game.update(cards=cards, target=target, swaps=swaps)
    return game


CHINCHIRO_ORDER = ('menashi', 'hifumi', 'normal', 'shigoro', 'zorome', 'pinzoro')


def chinchiro_hand(dice):
    a, b, c = sorted(dice)
    if a == c:
        return ('pinzoro', None) if a == 1 else ('zorome', a)
    if (a, b, c) == (4, 5, 6):
        return 'shigoro', None
    if a == b or b == c:
        return 'normal', c if a == b else a
    if (a, b, c) == (1, 2, 3):
        return 'hifumi', None
    return 'menashi', None


def chinchiro_rank(move):
    return CHINCHIRO_ORDER.index(move['yaku']), move['point'] or 0


def chinchiro_strength(move):
    if move['yaku'] == 'normal':
        return 3 if move['point'] == 6 else 2 if move['point'] >= 4 else 1
    return {'pinzoro': 8, 'zorome': 6, 'shigoro': 4}.get(move['yaku'], 1)


def play_chinchiro(game, rng):
    anoma = game.get('anoma')
    rolls = []
    for _ in range(1 if anoma else 3):
        roll = [rng.randrange(1, 7) for _ in range(3)]
        rolls.append(roll)
        yaku, point = chinchiro_hand(roll)
        if yaku != 'menashi':
            break
    if not anoma:
        move = dict(side='anoma', rolls=rolls, yaku=yaku, point=point)
        game['moves'].append(move)
        game['anoma'] = move
        return

    attempt = game['moves'][-1].get('attempt', 0) + 1
    move = dict(side='player', roll=roll, yaku=yaku, point=point, attempt=attempt)
    game['moves'].append(move)
    if yaku == 'menashi' and attempt < 3:
        return
    player_rank, anoma_rank = chinchiro_rank(move), chinchiro_rank(anoma)
    if player_rank == anoma_rank:
        move['result'] = 'tie'
        del game['anoma']
        return
    won = player_rank > anoma_rank
    game.update(outcome='win' if won else 'loss', label='WIN' if won else 'LOSE',
                strength=chinchiro_strength(move if won else anoma))


def play_beginner_game(game, choice, rng=None):
    rng = rng or secrets.SystemRandom()
    kind = game['kind']
    if kind == 'chinchiro':
        if choice is not None:
            raise ValueError('サイコロには選択肢がありません。')
        return play_chinchiro(game, rng)
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
    if rng.random() < .05:
        outcome, differences, strength = 'win', [0], 1
    else:
        outcome = 'win' if draw(.45) else 'loss'
        differences, strength = rng.choices([([9], 10), ([7, 8], 9), ([4, 5, 6], 2), ([1, 2, 3], 1)], [20, 25, 25, 30])[0]
    hand = matching_deal(kind, outcome, rng, set(differences))
    return {'kind': kind, 'outcome': outcome, 'strength': strength, 'label': f"{hand['difference']}点差",
            'rounds': [hand]}
