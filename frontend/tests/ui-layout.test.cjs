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

test('the edition label follows the paper and its tab toggles the diff in place', async () => {
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
  const bar = () => ui.find(n => n.props.className === 'paper-tabs result-tabs');
  assert.match(meta(), /第2版/);
  assert.equal(text(ui.find(n => n.props.className === 'paper-stamp stamp-loss')), '敗北');
  assert.doesNotMatch(text(ui.tree), /紙に残る粉/);
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

test('gambling actions stay with the tabletop object and generation polling only reads the active session', async () => {
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
  const table = () => ui.find(n => n.props['aria-label'] === '一発サイコロの進行');
  const actions = () => ui.find(n => n.props.className === 'gamble-actions');
  assert.ok(nodes(table(), n => n.props.className === 'dice-game').length);
  assert.match(text(table()), /サイコロを振る/);
  assert.equal(requests.filter(([url]) => url.endsWith('/play')).length, 0);
  ui.click('サイコロを振る'); await flush(); ui.draw();
  assert.equal(nodes(actions(), n => n.type === 'button')[0].props.disabled, true);
  ui.tick(); await flush(); ui.draw();
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
