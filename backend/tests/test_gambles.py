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
