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

test('result metadata follows the paper and the action bar toggles the diff in place', async () => {
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
  await startStory(ui);
  const meta = () => text(ui.find(n => n.props.className === 'game-heading'));
  const paper = () => ui.find(n => n.type === 'article');
  const bar = () => ui.find(n => n.props.className === 'action-bar result-bar');
  assert.match(meta(), /第2版・敗北/);
  assert.match(text(ui.find(n => n.props.className === 'result-meta')), /失った言葉 猫・紙に残る粉/);
  assert.equal(ui.find(n => n.props.className === 'paper-caption'), undefined);
  assert.match(text(bar()), /どこが変わった？.*次は何をねらう？/);
  const page = paper().key;
  ui.click('どこが変わった？');
  assert.equal(paper().key, page);
  assert.match(paper().props.className, /show-changes/);
  ui.click('どこが変わった？');
  assert.equal(paper().key, page);
  assert.doesNotMatch(paper().props.className, /show-changes/);
  ui.find(n => n.props.role === 'slider').props.onKeyDown({ key: 'Enter', preventDefault() {} });
  ui.draw();
  ui.tick();
  assert.match(meta(), /第1版/);
  ui.unmount();
});

test('gambling actions stay in the footer and generation polling only reads the active session', async () => {
  const transaction = {
    id: 'first', status: 'playing', stakes: ['猫'], offer: { title: '心の声' },
    gamble: { kind: 'dice', rounds: [], moves: [] },
  };
  const played = { ...session, status: 'playing', transactions: [transaction] };
  const settledGamble = { ...transaction.gamble, outcome: 'win', moves: [{ face: 6, outcome: 'win' }] };
  const generating = { ...played, status: 'generating', transactions: [{ ...transaction, gamble: settledGamble }] };
  const requests = gameApi(url => url.endsWith('/play') ? generating
    : url.endsWith('/sessions/played') ? { ...generating, status: 'awaiting_reveal' } : played);
  const ui = mount(App, {});
  await startStory(ui);
  const bar = () => ui.find(n => n.props.className === 'action-bar gamble-bar');
  const hero = ui.find(n => n.props.className === 'game-hero');
  assert.ok(nodes(hero, n => n.props.className === 'dice-game').length);
  assert.doesNotMatch(text(hero), /サイコロを振る/);
  assert.match(text(bar()), /サイコロを振る/);
  assert.equal(requests.filter(([url]) => url.endsWith('/play')).length, 0);
  ui.click('サイコロを振る'); await flush(); ui.draw();
  assert.equal(nodes(bar(), n => n.type === 'button')[0].props.disabled, true);
  ui.tick(); await flush(); ui.draw();
  assert.equal(nodes(bar(), n => n.type === 'button')[0].props.disabled, false);
  assert.deepEqual(requests.filter(([url]) => url.endsWith('/sessions/played')), [['/api/sessions/played', 'GET']]);
  assert.equal(requests.filter(([url]) => url.endsWith('/finish')).length, 0);
  ui.unmount();
});

test('the game reserves fixed rows and story selection scrolls its list', () => {
  const css = fs.readFileSync('frontend/src/layout.css', 'utf8');
  assert.match(css, /height: 100dvh;\s*overflow: hidden/);
  assert.match(css, /grid-template-rows: 24px auto minmax\(0, 1fr\) 64px/);
  assert.match(css, /\.game-hero \{[^}]*align-items: safe center/);
  assert.match(css, /\.action-bar \{[^}]*grid-row: 4/);
  assert.match(css, /\.choosing \.story-list \{[^}]*overflow-y: auto/);
});
