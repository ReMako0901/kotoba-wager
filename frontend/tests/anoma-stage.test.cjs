const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { jsx, jsxs } = require('react/jsx-runtime');
const { AnomaStageProvider, AnomaStage, StagePublisher } = require('../src/Anoma.tsx');
const App = require('../src/App.tsx').default;
const { scenePools } = require('../src/sceneDialogue.ts');
function assertScene(ui, key) {
  assert.ok(scenePools[key].lines.some(line => text(stage(ui)) === 'アノマ' + line), key);
  assert.ok(scenePools[key].expressions.includes(stage(ui).props['data-expression']), key);
}
const stage = ui => ui.find(n => n.type === 'aside' && n.props['aria-label'] === 'アノマ');
const flush = () => new Promise(resolve => setImmediate(resolve));

function Host({ visible, lines, expression = 'taunt' }) {
  return jsxs(AnomaStageProvider, { children: [jsx(AnomaStage, {}), visible && jsx(StagePublisher, { lines, expression })] });
}
test('publisher draws nothing, updates lines and expression, and resets on unmount', () => {
  const ui = mount(Host, { visible: false });
  assert.equal(stage(ui).props['data-expression'], 'normal');
  assert.equal(text(stage(ui)), 'アノマ');
  ui.draw({ visible: true, lines: ['一行目', '二行目'], expression: 'surprise' });
  assert.equal(stage(ui).props['data-expression'], 'surprise');
  assert.deepEqual(ui.all(n => n.type === 'p').map(text), ['一行目', '二行目']);
  assert.equal(ui.all(n => n.type === 'aside').length, 1);
  ui.draw({ visible: true, lines: ['次の台詞'], expression: 'smile' });
  assert.equal(text(stage(ui)), 'アノマ次の台詞');
  assert.equal(stage(ui).props['data-expression'], 'smile');
  ui.draw({ visible: false });
  assert.equal(stage(ui).props['data-expression'], 'normal');
  assert.equal(text(stage(ui)), 'アノマ');
});
test('stage is shared on title, opening and story selection; all have dialogue', async () => {
  global.localStorage = { getItem: () => null, setItem() {} };
  global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/games') ? { games: [] } : { stories: [], exhausted: false } });
  const ui = mount(App, {}); await flush(); ui.draw();
  for (const action of [null, 'はじめる', 'スキップ']) {
    if (action) { ui.click(action); await flush(); ui.draw(); }
    assert.equal(ui.all(n => n.props.className === 'anoma-stage').length, 1);
    if (action === 'はじめる') assert.equal(stage(ui).props['data-expression'], 'normal');
    const shell = ui.find(n => String(n.props.className).startsWith('app-shell'));
    const elements = shell.props.children.filter(n => n && typeof n === 'object');
    assert.equal(elements[0].props.className, 'navigation-bar');
    assert.equal(elements[1].props.className, 'anoma-stage');
    if (action !== 'はじめる') assertScene(ui, action ? 'storySelect' : 'title');
  }
});
test('game publishes scene dialogue for reward, generation, gambling and title', async () => {
  for (const [status, gamble, scene] of [['ready', false, 'rewardSelect'], ['generating', false, 'generating'], ['generating', true, 'gamblePlay:dice']]) {
    global.localStorage = { getItem: key => key === 'story-wager-session-count-v1' ? 'saved' : null, setItem() {} };
    const session = { id: 'saved', betting_mode: 'count-v1', status, view: 'select', version: 1, text: '猫。', title: '物語', offers: [], lost_concepts: [], usage: {},
      transactions: gamble ? [{ id: 'r', status: 'generating', stakes: ['猫'], offer: { title: '報酬' }, gamble: { kind: 'dice', strength: 1, outcome: null, rounds: [], moves: [] } }] : [] };
    global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/games') ? { games: [] } : session });
    const ui = mount(App, {}); await flush(); ui.draw();
    ui.click('つづきから'); await flush(); ui.draw();
    assertScene(ui, scene);
    ui.click('タイトルへ');
    assertScene(ui, 'title');
    ui.unmount();
  }
});
test('all dialogue owners publish and obsolete embedded frames are removed', () => {
  const anoma = fs.readFileSync('frontend/src/Anoma.tsx', 'utf8');
  const app = fs.readFileSync('frontend/src/App.tsx', 'utf8');
  const progress = fs.readFileSync('frontend/src/StoryProgress.tsx', 'utf8');
  assert.match(anoma, /StagePublisher lines=\{\[scenario.opening\[index\]\]\}/);
  assert.match(app, /<ScenePublisher scene=\{gameScene/);
  assert.match(app, /StagePublisher lines=\{\[reaction.line\]/);
  assert.equal((progress.match(/<StagePublisher /g) ?? []).length, 2);
  assert.doesNotMatch(anoma + app + progress, /AnomaFrame|AnomaResult/);
  const css = fs.readFileSync('frontend/src/anoma.css', 'utf8');
  assert.match(css, /position: sticky;\s*top: 0/);
  assert.match(css, /height: 116px/);
  assert.match(css, /height: 5.6em;\s*overflow-y: auto/);
  assert.match(css, /object-fit: cover; object-position: 50% 20%/);
});
