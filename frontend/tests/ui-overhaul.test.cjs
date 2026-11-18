const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, nodes, text } = require('./component-harness.cjs');
const { drawStories, startStory } = require('./app-flow-harness.cjs');
const App = require('../src/App.tsx').default;
const { BeginnerPlay } = require('../src/BeginnerPlay.tsx');

const flush = () => new Promise(resolve => setImmediate(resolve));

test('title folio and story selection header structure the entry screens without continue buttons', async () => {
  global.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/games') ? { games: [] } : drawStories(url) ?? { stories: [], exhausted: false },
  });
  const ui = mount(App, {});
  await flush();
  ui.draw();
  assert.ok(ui.find(n => n.props.className === 'title-screen'));
  const folio = ui.find(n => n.props.className === 'title-folio');
  const actions = ui.find(n => n.props.className === 'title-actions');
  assert.ok(folio);
  assert.ok(actions);
  assert.match(text(folio), /ギャンブル.*ライティングメーカー.*言葉を賭けて、物語を書き換える/);
  const actionButtons = nodes(actions, n => n.type === 'button');
  assert.equal(actionButtons.length, 2);
  assert.match(text(actionButtons[0]), /はじめる/);
  assert.equal(text(actionButtons[1]), '遊び方');
  assert.doesNotMatch(text(ui.tree), /つづき/);

  ui.click('はじめる');
  await flush();
  ui.draw();
  assert.ok(ui.find(n => n.props.className === 'opening-screen'));
  ui.click('スキップ');
  await flush();
  ui.draw();
  assert.ok(ui.find(n => n.props.className === 'choose-screen'));
  assert.ok(ui.find(n => n.props.className === 'choose-header'));
  ui.unmount();
});

test('rock-paper-scissors shows an arena before a move and highlights the settled outcome', () => {
  const standby = mount(BeginnerPlay, {
    gamble: { kind: 'rps', rounds: [], moves: [] },
    busy: false,
    onMove() {},
    children: null,
  });
  const board = standby.find(n => n.props.className?.includes('rps-result'));
  assert.ok(board);
  assert.match(board.props.className, /rps-standby/);
  assert.match(text(board), /アノマ.*？.*あなた.*？/);
  standby.unmount();

  const settled = mount(BeginnerPlay, {
    gamble: { kind: 'rps', outcome: 'win', rounds: [], moves: [{ choice: 0, opponent: 2, outcome: 'win' }] },
    busy: false,
    onMove() {},
    children: null,
  });
  const settledBoard = settled.find(n => n.props.className?.includes('rps-result'));
  assert.match(settledBoard.props.className, /rps-settled rps-win/);
  assert.match(text(settledBoard), /アノマ.*✌️.*チョキ.*あなた.*✊.*グー/);
  settled.unmount();
});

test('stake counter lights up on readiness and result screen applies win/loss celebratory classes', async () => {
  const offer = { id: 'offer-1', title: '心の声', description: '本音が漏れる', required_count: 1 };
  let currentSession = {
    id: 'played', betting_mode: 'count-v1', title: '猫の物語', status: 'ready', view: 'game',
    version: 1, text: '猫が来た。', offers: [offer], lost_concepts: [],
    analysis: { units: [{ id: 'u1', text: '猫', stakeable: true }, { id: 'u2', text: 'が来た。', stakeable: false }] },
    transactions: [],
  };
  global.fetch = async url => ({
    ok: true,
    json: async () => drawStories(url) ?? (url.endsWith('/games') ? { games: [{ id: 'rps', name: 'じゃんけん', tier: 'beginner' }] } : currentSession),
  });
  const ui = mount(App, {});
  await startStory(ui);
  ui.click('心の声');
  const count = () => ui.find(n => n.props['aria-label'] === '選んだ個数');
  assert.equal(count().props.className, 'stake-count');
  ui.click('猫');
  assert.equal(count(), undefined);
  ui.click('閉じる');
  assert.equal(count().props.className, 'stake-count stakes-ready');
  ui.unmount();

  currentSession = {
    ...currentSession,
    view: 'result',
    version: 2,
    text: '猫が笑った。',
    transactions: [{
      id: 'tx-win', source_version: 1, status: 'committed', outcome: 'win',
      before: '猫が来た。', after: '猫が笑った。', stakes: ['猫'], lost: [], offer,
    }],
  };
  const winUi = mount(App, {}, true);
  await startStory(winUi);
  const main = winUi.find(n => n.type === 'main');
  assert.match(main.props.className, /result-win-view/);
  const badge = winUi.find(n => n.props.className?.includes('edition-badge'));
  assert.ok(badge);
  assert.equal(text(badge), '第2版');
  assert.equal(text(winUi.find(n => n.props.className === 'paper-stamp stamp-win')), '勝利');
  winUi.unmount();
});

test('CSS defines manuscript header/footer framing, celebratory result styling and arena layout', () => {
  const historyCss = fs.readFileSync('frontend/src/history.css', 'utf8');
  const layoutCss = fs.readFileSync('frontend/src/layout.css', 'utf8');
  const beginnerCss = fs.readFileSync('frontend/src/beginner-games.css', 'utf8');
  assert.match(historyCss, /【 原 稿 】/);
  assert.match(historyCss, /【 改 稿 成 就 】/);
  assert.match(historyCss, /\.result-win-view \.manuscript-sheet/);
  assert.match(layoutCss, /\.stake-count\.stakes-ready/);
  assert.match(beginnerCss, /\.rps-result::after/);
  assert.match(beginnerCss, /\.dice-face\.dice-win i/);
});
