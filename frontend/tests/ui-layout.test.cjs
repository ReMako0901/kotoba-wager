const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, nodes, text } = require('./component-harness.cjs');
const { drawStories, startStory } = require('./app-flow-harness.cjs');
const App = require('../src/App.tsx').default;

const flush = () => new Promise(resolve => setImmediate(resolve));
const session = {
  id: 'played', betting_mode: 'count-v1', title: '猫の物語', status: 'ready', view: 'game',
  version: 1, text: '猫が来た。', offers: [], lost_concepts: [], transactions: [],
};

function gameApi(response) {
  const requests = [];
  global.fetch = async (url, { method }) => {
    requests.push([url, method]);
    const data = drawStories(url) ?? (url.endsWith('/games') ? { games: [] } : response(url));
    return { ok: true, json: async () => data };
  };
  return requests;
}

test('the edition label follows the paper and the latest result highlights changes immediately', async () => {
  const result = {
    ...session, view: 'result', version: 2, text: '犬が来た。',
    transactions: [{
      id: 'first', source_version: 1, status: 'committed', outcome: 'loss',
      before: session.text, after: '犬が来た。', stakes: ['猫'], lost: [{ label: '猫' }],
      offer: { title: '心の声' },
    }],
  };
  gameApi(() => result);
  const ui = mount(App, {}, true);
  const flags = new Map();
  window.localStorage = { getItem: key => flags.get(key), setItem: (key, value) => flags.set(key, value) };
  await startStory(ui);
  const meta = () => text(ui.find(n => n.props.className === 'game-heading'));
  const paper = () => ui.find(n => n.type === 'article');
  const bar = () => ui.find(n => n.props.className === 'paper-tabs result-tabs');
  assert.match(meta(), /第2版/);
  assert.equal(text(ui.find(n => n.props.className === 'paper-stamp stamp-loss')), '敗北');
  assert.doesNotMatch(text(ui.tree), /紙に残る粉/);
  assert.equal(ui.find(n => n.props.className === 'paper-caption'), undefined);
  assert.match(text(bar()), /次は何をねらう？/);
  assert.doesNotMatch(text(bar()), /どこが変わった？/);
  assert.match(paper().props.className, /show-changes/);
  assert.match(text(paper()), /右下をめくると、変更が見れる/);
  ui.find(n => n.props.role === 'slider').props.onKeyDown({ key: 'Enter', preventDefault() {} });
  ui.draw();
  ui.tick();
  assert.match(meta(), /第1版/);
  assert.doesNotMatch(paper().props.className, /show-changes/);
  ui.click('取引履歴');
  ui.click('取引履歴');
  ui.find(n => n.props.role === 'slider').props.onKeyDown({ key: 'Enter', preventDefault() {} });
  ui.draw();
  ui.tick();
  assert.match(meta(), /第2版/);
  assert.doesNotMatch(text(paper()), /右下をめくると/);
  ui.unmount();
  const again = mount(App, {});
  window.localStorage = { getItem: key => flags.get(key) };
  await startStory(again);
  assert.doesNotMatch(text(again.tree), /右下をめくると/);
  again.unmount();
});

test('gambling actions stay with the tabletop object and generation polling only reads the active session', async () => {
  const anoma = { side: 'anoma', rolls: [[1, 2, 3]], yaku: 'hifumi', point: null };
  const transaction = {
    id: 'first', status: 'playing', stakes: ['猫'], offer: { title: '心の声' },
    gamble: { kind: 'chinchiro', rounds: [], moves: [anoma] },
  };
  const played = { ...session, status: 'playing', transactions: [transaction] };
  const settledGamble = { ...transaction.gamble, outcome: 'win', moves: [anoma, { side: 'player', roll: [4, 5, 6], attempt: 1, yaku: 'shigoro', point: null }] };
  const generating = { ...played, status: 'generating', transactions: [{ ...transaction, gamble: settledGamble }] };
  const requests = gameApi(url => url.endsWith('/play') ? generating
    : url.endsWith('/sessions/played') ? { ...generating, status: 'awaiting_reveal' } : played);
  const ui = mount(App, {});
  await startStory(ui);
  const table = () => ui.find(n => n.props['aria-label'] === 'チンチロ');
  const actions = () => ui.find(n => n.props.className?.startsWith('folio-outcome-slip'));
  const land = () => {
    const roll = ui.find(n => n.props.className === 'chin-roll rolling');
    roll.props.onAnimationEnd({ target: roll, currentTarget: roll });
    ui.draw();
  };
  land();
  assert.match(text(table()), /ヒフミ/);
  assert.equal(requests.filter(([url]) => url.endsWith('/play')).length, 0);
  ui.tick();
  ui.click('丼を振る'); await flush(); ui.draw();
  assert.equal(actions(), undefined);
  land();
  ui.tick(); await flush(); ui.draw();
  assert.ok(actions());
  assert.match(text(ui.find(n => n.props.className?.startsWith('folio-outcome-banner'))), /勝利/);
  assert.equal(ui.all(n => n.props.className?.includes('folio-wax-seal')).length, 0);
  assert.equal(nodes(actions(), n => n.type === 'button')[0].props.disabled, false);
  assert.deepEqual(requests.filter(([url]) => url.endsWith('/sessions/played')), [['/api/sessions/played', 'GET']]);
  assert.equal(requests.filter(([url]) => url.endsWith('/finish')).length, 0);
  ui.unmount();
});

test('photo and dialogue occupy the page margin above the controls', () => {
  const css = fs.readFileSync('frontend/src/notebook.css', 'utf8');
  const app = fs.readFileSync('frontend/src/App.tsx', 'utf8');
  const anoma = fs.readFileSync('frontend/src/Anoma.tsx', 'utf8');
  assert.match(css, /height: 100dvh/);
  assert.match(anoma, /<header className="page-margin">[^]*anoma-photo[^]*anoma-dialogue[^]*<\/header>\s*\{children\}/);
  assert.doesNotMatch(css, /overflow-y:\s*(auto|scroll)|blur\(/);
  assert.doesNotMatch(app, /import '[^']*(?:layout|table-finish|anoma)\.css'/);
});

test('each roll waits for landing and the upper face has the server pip count', () => {
  const { FreshGamble } = require('../src/games/FreshGamble.tsx');
  const moves = [];
  const calls = [];
  const props = { gamble: { kind: 'chinchiro', moves }, onMove: n => calls.push(n) };
  const ui = mount(FreshGamble, props);
  ui.draw({ ...props, busy: true });
  ui.tick();
  assert.deepEqual(calls, []);
  ui.draw(props);
  ui.draw({ ...props, onMove: n => calls.push(n) });
  ui.tick();
  ui.draw({ ...props, busy: true });
  ui.draw(props);
  ui.tick();
  assert.deepEqual(calls, [0]);
  moves.push({ side: 'anoma', rolls: [[1, 3, 5], [6, 2, 4], [2, 2, 1]], yaku: 'normal', point: 1 });
  ui.draw();

  function verifyFaces(expected) {
    const cubes = ui.all(n => n.props.className === 'chin-cube');
    assert.equal(cubes.length, 3);
    function rotation(n) {
      const [, axis, angle] = n.props.style.transform.match(/rotate([XY])\((-?\d+)deg\)/);
      return [axis, Number(angle)];
    }
    cubes.forEach((cube, i) => {
      const [axis, angle] = rotation(cube);
      const top = nodes(cube, n => n.props.className === 'chin-face').filter(face => {
        const [faceAxis, faceAngle] = rotation(face);
        return axis === faceAxis && (angle + faceAngle) % 360 === 0;
      });
      assert.equal(top.length, 1);
      assert.equal(nodes(top[0], n => n.props.className === 'pip').length, expected[i]);
    });
  }

  function land(expected) {
    verifyFaces(expected);
    const roll = ui.find(n => n.props.className === 'chin-roll rolling');
    assert.ok(!ui.find(n => n.type === 'button' && !n.props.disabled));
    roll.props.onAnimationEnd({ target: roll, currentTarget: roll });
    ui.draw();
  }

  for (const roll of moves[0].rolls) land(roll);
  verifyFaces([2, 2, 1]);
  ui.tick();
  ui.click('丼を振る');
  moves.push({ side: 'player', roll: [1, 3, 6], yaku: 'menashi', point: null, attempt: 1 });
  ui.draw();
  land([1, 3, 6]);
  assert.equal(text(ui.find(n => n.props.className === 'folio-hand-call')), '目なし');
  ui.tick();
  ui.click('もう一度振る');
  moves.push({ side: 'player', roll: [3, 1, 3], yaku: 'normal', point: 1, attempt: 2, result: 'tie' });
  ui.draw();
  land([3, 1, 3]);
  ui.tick();
  assert.match(text(ui.tree), /同点/);
  assert.equal(text(ui.find(n => n.props.role === 'status')), 'アノマのターンです');
  ui.tick();
  assert.deepEqual(calls, [0, 1, 2, 3]);
  ui.unmount();
});

test('baccarat reveals only on a full squeeze and counts each complete hand separately', () => {
  const { FreshGamble } = require('../src/games/FreshGamble.tsx');
  const card = { rank: 'K', suit: '♥' };
  const ui = mount(FreshGamble, { gamble: { kind: 'baccarat', rounds: [{
    player: [card, card, card], banker: [card, card], outcome: 'win',
  }] } });
  const slider = () => ui.find(n => n.props.role === 'slider');
  const target = { getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 140, width: 100, height: 140 }),
    setPointerCapture() {} };
  const event = x => ({ currentTarget: target, pointerId: 1, isPrimary: true, clientX: x, clientY: 70 });
  const drag = x => {
    slider().props.onPointerDown(event(0));
    slider().props.onPointerMove(event(x));
    ui.draw();
  };
  drag(74);
  assert.equal(slider().props['aria-valuenow'], 74);
  slider().props.onPointerUp(event(74)); ui.draw();
  assert.equal(slider().props['aria-valuenow'], 0);
  drag(75); drag(75);
  assert.doesNotMatch(text(ui.tree), /下1桁/);
  ui.click('バンカーをまとめて開く');
  assert.equal(ui.all(n => n.props.className === 'folio-ink-total').length, 1);
  drag(75);
  assert.equal(ui.all(n => n.props.className === 'folio-ink-total').length, 2);
  assert.equal(ui.all(n => n.type === 'img' || n.props.className === 'folio-card-corner').length, 0);
});

test('blackjack announces each opening natural before the outcome', () => {
  const { FreshGamble } = require('../src/games/FreshGamble.tsx');
  const hand = [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♥' }];
  const ui = mount(FreshGamble, { gamble: { kind: 'blackjack', rounds: [{ player: hand, banker: hand }] } });
  const call = () => text(ui.find(n => n.props.className === 'folio-hand-call'));
  for (let i = 0; i < 5; i++) ui.tick();
  assert.equal(call(), 'あなたブラックジャック！');
  ui.tick(); ui.tick();
  assert.equal(call(), 'アノマブラックジャック！');
  assert.equal(ui.find(n => n.props.className?.startsWith('folio-outcome-banner')), undefined);
  ui.tick(); ui.tick();
  assert.ok(ui.find(n => n.props.className?.startsWith('folio-outcome-banner')));
});

test('rps keeps the chosen slip through the chant and reveals the opponent before the outcome', () => {
  const { FreshGamble } = require('../src/games/FreshGamble.tsx');
  const props = { gamble: { kind: 'rps', moves: [] }, onMove() {} };
  const ui = mount(FreshGamble, props);
  ui.click('グーを出す');
  ui.draw({ ...props, gamble: { ...props.gamble, outcome: 'win', moves: [{ choice: 0, opponent: 2, outcome: 'win' }] } });
  const banner = () => ui.find(n => n.props.className?.startsWith('folio-outcome-banner'));
  for (const beat of ['じゃん', 'けん', 'ぽん']) {
    assert.equal(text(ui.find(n => n.props.className?.startsWith('rps-call'))), beat);
    assert.equal(ui.all(n => n.props.className?.includes('is-hidden')).length, 2);
    assert.equal(banner(), undefined);
    ui.tick();
  }
  assert.match(text(ui.tree), /アノマの札チョキ/);
  assert.equal(banner(), undefined);
  ui.tick();
  assert.match(text(banner()), /勝利/);
});
