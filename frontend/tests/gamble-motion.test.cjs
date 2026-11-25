const test = require('node:test');
const assert = require('node:assert/strict');
const { mount, text } = require('./component-harness.cjs');
const { GamblePlay } = require('../src/GamblePlay.tsx');
const { GenerationSkeleton } = require('../src/GambleMotion.tsx');
const { isNearMiss } = require('../src/gamblePresentation.ts');
const card = rank => ({ rank, suit: '♠' });
const round = outcome => ({ player: [card('4'), card('5'), card('2')], banker: [card('3'), card('6'), card('A')],
  dealer_hands: [[card('K'), card('8')], [card('K'), card('7')]], outcome, player_total: 1, banker_total: 0, difference: 1 });
function fixture(kind, outcome = 'win') {
  return { kind, outcome: ['rps', 'dice', 'card_guess'].includes(kind) ? null : outcome,
    reels: ['ベル', 'ベル', 'BIG'], rounds: [round(outcome)],
    ...(['rps', 'dice', 'card_guess'].includes(kind) ? { moves: [] } : {}),
    cards: [card('A'), card('K'), card('Q')], target: 0, swaps: [[0, 1], [1, 2]] };
}
function play(gamble, reduced = false) {
  const calls = [];
  const props = { gamble, busy: false, prepared: true, onMove: (...args) => calls.push(['move', ...args]), onFinish: () => calls.push(['finish']) };
  return { ui: mount(GamblePlay, props, reduced), props, calls };
}
const hasFinish = ui => !!ui.find(n => n.type === 'button' && text(n).includes('この結果を物語へ'));
for (const kind of ['rps', 'card_guess', 'dice', 'slot', 'blackjack', 'baccarat']) for (const reduced of [false, true]) test(`${kind}: no input never completes (reduced=${reduced})`, () => {
  const { ui, calls } = play(fixture(kind), reduced);
  for (let i = 0; i < 12; i++) ui.tick();
  assert.equal(hasFinish(ui), false);
  assert.deepEqual(calls, []);
});
test('dealer objects put opposing hands across the table and expose physical controls', () => {
  const klass = (ui, name) => ui.find(n => n.props.className === name);
  const rps = play(fixture('rps')).ui;
  assert.deepEqual(rps.all(n => /^rps-side /.test(n.props.className ?? '')).map(text), ['アノマ？', 'あなた？']);
  assert.ok(klass(play(fixture('dice')).ui, 'dice-game'));
  const guess = play(fixture('card_guess')).ui;
  assert.equal(klass(guess, 'guess-board').props['data-dealing'], true);
  assert.equal(guess.all(n => /guess-card playing-card/.test(n.props.className ?? '')).length, 3);
  const slot = play(fixture('slot')).ui;
  assert.ok(klass(slot, 'slot-machine'));
  assert.ok(klass(slot, 'slot-lever'));
  assert.equal(slot.all(n => n.props.className === 'reel-strip').length, 3);
  for (const kind of ['blackjack', 'baccarat']) {
    const ui = play(fixture(kind)).ui;
    assert.ok(klass(ui, 'dealt-hands'));
    assert.deepEqual(ui.all(n => n.props.className === 'card-hand').map(n => n.props['data-side']), ['banker', 'player']);
  }
  const baccarat = play(fixture('baccarat')).ui;
  baccarat.click('バンカーの1枚目');
  assert.ok(klass(baccarat, 'baccarat-zoom squeeze-back'));
});
for (const outcome of ['win', 'loss']) for (const skip of [false, true]) test(`slot: manual stops / explicit skip (${outcome}, skip=${skip})`, () => {
  const gamble = fixture('slot', outcome), snapshot = JSON.stringify(gamble);
  const { ui, calls } = play(gamble);
  if (skip) ui.click('演出をスキップ');
  else {
    assert.equal(ui.find(n => n.type === 'button' && text(n) === 'STOP 2').props.disabled, true);
    ui.click('字輪を回す');
    ui.click('STOP 2'); ui.tick(); assert.equal(hasFinish(ui), false);
    ui.click('STOP 1'); ui.tick(); assert.equal(hasFinish(ui), false);
    ui.click('STOP 3');
  }
  assert.equal(hasFinish(ui), true); assert.deepEqual(calls, []);
  ui.click('この結果を物語へ'); assert.deepEqual(calls, [['finish']]);
  assert.equal(JSON.stringify(gamble), snapshot);
});
for (const outcome of ['win', 'loss']) test(`blackjack: HIT and STAND control completion (${outcome})`, () => {
  const { ui, calls } = play(fixture('blackjack', outcome));
  ui.click('HIT'); for (let i = 0; i < 5; i++) ui.tick();
  assert.equal(hasFinish(ui), false);
  ui.click('結果を見る'); assert.equal(hasFinish(ui), true);
  assert.deepEqual(calls, []); ui.click('この結果を物語へ'); assert.deepEqual(calls, [['finish']]);
});
test('blackjack: initial 21 still waits for STAND; explicit skip is independent of timers', () => {
  const gamble = fixture('blackjack'); gamble.rounds[0].player = [card('A'), card('K')];
  const { ui } = play(gamble); ui.tick(); assert.equal(hasFinish(ui), false);
  ui.click('結果を見る'); assert.equal(hasFinish(ui), true);
  const skipped = play(fixture('blackjack')); skipped.ui.click('演出をスキップ'); assert.equal(hasFinish(skipped.ui), true);
});
function openRound(ui) {
  for (const label of ['あなた / プレイヤー', 'バンカー']) for (let i = 1; i <= 3; i++) {
    ui.click(`${label}の${i}枚目`); ui.click('表にする');
  }
}
for (const outcome of ['win', 'loss']) test(`baccarat: manually opening every card reaches result (${outcome})`, () => {
  const gamble = fixture('baccarat', outcome), snapshot = JSON.stringify(gamble);
  const { ui, calls } = play(gamble); openRound(ui);
  assert.equal(hasFinish(ui), true); assert.deepEqual(calls, []);
  ui.click('この結果を物語へ'); assert.deepEqual(calls, [['finish']]);
  assert.equal(JSON.stringify(gamble), snapshot);
});
test('baccarat: tie waits for replay action, final round and skip reach result', () => {
  const gamble = fixture('baccarat'); gamble.rounds.unshift(round('tie'));
  const { ui } = play(gamble); openRound(ui); ui.tick(); assert.equal(hasFinish(ui), false);
  ui.click('同じことばでもう一度'); ui.tick(); assert.equal(hasFinish(ui), false);
  openRound(ui); assert.equal(hasFinish(ui), true);
  const skipped = play(gamble); skipped.ui.click('演出をスキップ'); assert.equal(hasFinish(skipped.ui), true);
});
test('baccarat: keyboard squeeze and banker open remain manual', () => {
  const gamble = fixture('baccarat'); gamble.rounds[0].player = [card('4'), card('5')]; gamble.rounds[0].banker = [card('3'), card('6')];
  const { ui } = play(gamble);
  for (let i = 1; i <= 2; i++) {
    ui.click(`あなた / プレイヤーの${i}枚目`);
    for (let j = 0; j < 7; j++) {
      ui.find(n => n.props?.className?.includes('baccarat-zoom')).props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }); ui.draw();
    }
  }
  assert.equal(hasFinish(ui), false); ui.click('バンカーオープン'); assert.equal(hasFinish(ui), true);
});
for (const kind of ['rps', 'dice', 'card_guess']) test(`${kind}: explicit move, saved result, explicit finish`, () => {
  const gamble = fixture(kind); const { ui, props, calls } = play(gamble, true);
  if (kind === 'card_guess') { ui.click('シャッフル開始'); ui.click('シャッフル演出をスキップ'); assert.deepEqual(calls, []); ui.click('中央のカード'); }
  else ui.click(kind === 'rps' ? 'グー' : 'サイコロを振る');
  assert.deepEqual(calls, [['move', 0, ...(kind === 'rps' ? [0] : kind === 'card_guess' ? [1] : [])]]);
  assert.equal(hasFinish(ui), false);
  const move = kind === 'rps' ? { choice: 0, opponent: 2, outcome: 'win' } : kind === 'dice' ? { face: 6, outcome: 'win' } : { choice: 1, answer: 1, outcome: 'win' };
  const saved = { ...gamble, outcome: 'win', moves: [move] }, snapshot = JSON.stringify(saved);
  ui.draw({ ...props, gamble: saved }); assert.equal(hasFinish(ui), true);
  ui.click('この結果を物語へ'); assert.equal(calls.at(-1)[0], 'finish'); assert.equal(JSON.stringify(saved), snapshot);
});
test('rps: tie does not complete and replay uses the next attempt', () => {
  const gamble = { ...fixture('rps'), moves: [{ choice: 0, opponent: 0, outcome: 'tie' }] };
  const { ui, calls } = play(gamble); ui.tick(); assert.equal(hasFinish(ui), false);
  ui.click('パー'); assert.deepEqual(calls, [['move', 1, 1]]);
});
test('factual near misses and busy generation remain', () => {
  assert.equal(isNearMiss({ kind: 'slot', outcome: 'loss', reels: ['A', 'A', 'B'] }), true);
  assert.equal(isNearMiss({ kind: 'slot', outcome: 'win', reels: ['A', 'A', 'A'] }), false);
  assert.equal(isNearMiss({ kind: 'dice', outcome: 'loss', moves: [{ face: 3 }] }), true);
  assert.equal(isNearMiss({ kind: 'rps', outcome: 'loss' }), false);
  const { ui, props } = play(fixture('slot')); ui.click('演出をスキップ'); ui.draw({ ...props, prepared: false });
  assert.ok(ui.find(n => n.props?.className === 'generation-skeleton' && n.props['aria-busy'] === true));
  assert.ok(ui.find(n => n.type === 'button' && n.props.disabled && text(n).includes('この結果を物語へ') && n.props['aria-busy']));
  assert.equal(mount(GenerationSkeleton, {}).find(n => n.props.className === 'generation-skeleton').props.role, 'status');
});
