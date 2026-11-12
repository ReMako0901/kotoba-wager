from random import Random

import pytest

from app.gambles import deal_baccarat, deal_blackjack, make_gamble


class FixedChoice(Random):
    """Choose a known bucket and record the exact odds used by the game."""
    def __init__(self, index, ties=0):
        super().__init__(20)
        self.index = index
        self.ties = iter([.049] * ties + [.05])
        self.weights = None

    def random(self):
        return next(self.ties)

    _randbelow = Random._randbelow_with_getrandbits

    def choices(self, population, weights):
        self.weights = weights
        return [population[self.index]]


@pytest.mark.parametrize('index,symbol,strength', [(0,'ベル',1),(1,'スイカ',2),(2,'REG',4),(3,'BIG',8)])
def test_slot_uses_configured_symbols_and_odds(index, symbol, strength):
    rng = FixedChoice(index)
    plan = make_gamble('slot', lambda p: p == .5, rng)
    assert rng.weights == [65, 25, 5, 5]
    assert (plan['outcome'], plan['strength'], plan['reels']) == ('win', strength, [symbol] * 3)
    miss = make_gamble('slot', lambda p: False, Random(0))
    assert miss['strength'] == 2 and len(set(miss['reels'])) == 3


@pytest.mark.parametrize('wins', [True, False])
def test_blackjack_deck_matches_preselected_result(wins):
    plan = make_gamble('blackjack', lambda p: p == .6 and wins, Random(0))
    (hand,) = plan['rounds']
    assert len({(c['rank'], c['suit']) for c in hand['deck']}) == 52
    assert deal_blackjack(hand['deck']) == {k: v for k, v in hand.items() if k != 'deck'}
    assert hand['outcome'] == ('win' if wins else 'loss')
    assert plan['strength'] == 1


@pytest.mark.parametrize('index,margins,strength', [(0,{9},10),(1,{7,8},9),(2,{4,5,6},2),(3,{1,2,3},1)])
@pytest.mark.parametrize('wins', [True, False])
def test_baccarat_ties_and_final_deal_are_prearranged(index, margins, strength, wins):
    rng = FixedChoice(index, ties=2)
    probabilities = []
    plan = make_gamble('baccarat', lambda p: probabilities.append(p) or wins, rng)
    assert probabilities == [.45] and rng.weights == [20, 25, 25, 30]
    for hand in plan['rounds']:
        assert deal_baccarat(hand['deck']) == {k: v for k, v in hand.items() if k != 'deck'}
    assert [hand['outcome'] for hand in plan['rounds']] == ['tie', 'tie', 'win' if wins else 'loss']
    assert plan['strength'] == strength and plan['rounds'][-1]['difference'] in margins


@pytest.mark.parametrize('wins', [True, False])
def test_blackjack_hit_or_stand_keeps_result_and_uses_the_same_deck(wins):
    from app.gambles import blackjack_outcome, blackjack_total
    rng = Random(42)
    outcome = 'win' if wins else 'loss'
    hands_with_hits = 0
    for _ in range(100):
        plan = make_gamble('blackjack', lambda _: wins, rng)
        (hand,) = plan['rounds']
        hands_with_hits += len(hand['player']) > 2
        for hits, dealer in enumerate(hand['dealer_hands']):
            player = hand['player'][:2 + hits]
            assert player[2:] == hand['deck'][4:4 + hits]
            assert dealer[2:] == hand['deck'][4 + hits:4 + hits + len(dealer[2:])]
            assert blackjack_outcome(player, dealer) == outcome
            if len(dealer) > 2:
                assert blackjack_total(dealer[:-1]) < 17 <= blackjack_total(dealer)
    assert hands_with_hits


def test_rock_paper_scissors_has_exact_per_throw_odds():
    from collections import Counter
    from app.gambles import play_beginner_game

    counts = Counter()
    for value in range(100):
        class FixedRoll:
            def randrange(self, stop):
                assert stop == 100
                return value

        game = make_gamble('rps', lambda _: None)
        play_beginner_game(game, 1, FixedRoll())
        move = game['moves'][0]
        counts[move['outcome']] += 1
        expected = {'win': 0, 'loss': 2, 'tie': 1}
        assert move['opponent'] == expected[move['outcome']]
        assert game.get('strength') == (None if move['outcome'] == 'tie' else 2)
    assert counts == {'win': 33, 'loss': 33, 'tie': 34}


def test_card_choice_resolves_against_the_fixed_shuffle():
    from app.gambles import play_beginner_game

    game = make_gamble('card_guess', lambda _: None, Random(1))
    assert game['outcome'] is None and len(game['swaps']) == 8
    outcomes = []
    for choice in range(3):
        plan = {**game, 'moves': []}
        play_beginner_game(plan, choice)
        outcomes.append(plan['outcome'])
        assert plan['strength'] == (3 if plan['outcome'] == 'win' else 4)
    assert outcomes.count('win') == 1 and outcomes.count('loss') == 2


@pytest.mark.parametrize('face, outcome, strength', [
    (1, 'loss', 8), (2, 'loss', 1), (3, 'loss', 1),
    (4, 'win', 1), (5, 'win', 1), (6, 'win', 8),
])
def test_dice_has_two_extreme_faces(face, outcome, strength):
    from app.gambles import play_beginner_game

    class FixedDie:
        def randrange(self, start, stop):
            assert (start, stop) == (1, 7)
            return face

    game = make_gamble('dice', lambda _: None)
    play_beginner_game(game, None, FixedDie())
    assert game['moves'][0]['face'] == face
    assert (game['outcome'], game['strength']) == (outcome, strength)
