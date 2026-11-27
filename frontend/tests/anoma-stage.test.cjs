const { drawStories, startStory } = require('./app-flow-harness.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { jsx, jsxs } = require('react/jsx-runtime');
const { AnomaStageProvider, AnomaStage, StagePublisher } = require('../src/Anoma.tsx');
const App = require('../src/App.tsx').default;
const { scenePools } = require('../src/sceneDialogue.ts');
const { scenario } = require('../src/scenario.ts');
function assertScene(ui, key) {
  assert.ok(scenePools[key].lines.some(line => stageLine(ui) === line), key);
  assert.ok(scenePools[key].expressions.includes(stage(ui).props['data-expression']), key);
}
const stage = ui => ui.find(n => n.props.className === 'anoma-stage');
const stageLine = ui => text(ui.find(n => n.props.className === 'sr-only'));
const flush = () => new Promise(resolve => setImmediate(resolve));

function Host({ visible, lines, expression = 'taunt' }) {
  return jsxs(AnomaStageProvider, { children: [jsx(AnomaStage, {}), visible && jsx(StagePublisher, { lines, expression })] });
}
test('publisher draws nothing, updates lines and expression, and resets on unmount', () => {
  const ui = mount(Host, { visible: false });
  assert.equal(stage(ui).props['data-expression'], 'normal');
  assert.equal(stageLine(ui), '');
  ui.draw({ visible: true, lines: ['一行目', '二行目'], expression: 'surprise' });
  assert.equal(stage(ui).props['data-expression'], 'surprise');
  const displayed = () => ui.all(n => n.type === 'p').map(text);
  assert.equal(stageLine(ui), '一行目\n二行目');
  assert.deepEqual(displayed(), ['', '']);
  ui.tick();
  assert.deepEqual(displayed(), ['一', '']);
  ui.draw({ visible: true, lines: ['一行目', '二行目'], expression: 'surprise' });
  assert.deepEqual(displayed(), ['一', '']);
  for (let i = 0; i < 3; i++) ui.tick();
  assert.deepEqual(displayed(), ['一行目', '二']);
  assert.ok(ui.find(n => n.props.className?.includes('anoma-portrait-speaking')));
  ui.tick(); ui.tick();
  assert.deepEqual(displayed(), ['一行目', '二行目']);
  assert.equal(ui.find(n => n.props.className?.includes('anoma-portrait-speaking')), undefined);
  assert.equal(ui.all(n => n.type === 'aside').length, 1);
  ui.draw({ visible: true, lines: ['次の台詞'], expression: 'smile' });
  assert.equal(stageLine(ui), '次の台詞');
  assert.equal(stage(ui).props['data-expression'], 'smile');
  ui.draw({ visible: false });
  assert.equal(stage(ui).props['data-expression'], 'normal');
  assert.equal(stageLine(ui), '');
});
test('stage is shared on title, opening and story selection; all have dialogue', async () => {
  global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/games') ? { games: [] } : { stories: [], exhausted: false } });
  const ui = mount(App, {}); await flush(); ui.draw();
  for (const action of [null, 'はじめる', 'スキップ', 'プリセットの文で始める']) {
    if (action) { ui.click(action); await flush(); ui.draw(); }
    assert.equal(ui.all(n => n.props.className === 'anoma-stage').length, 1);
    const portrait = ui.find(n => n.props.className === 'anoma-photo');
    assert.equal(portrait.props['data-focus'], action && action !== 'はじめる' ? 'table' : 'portrait');
    if (action === 'はじめる') {
      assert.equal(stage(ui).props.inert, true);
      assert.ok(!text(ui.tree).includes(scenario.opening[0]));
    } else if (action !== 'スキップ') {
      assertScene(ui, action ? 'storySelect' : 'title');
    }
  }
  ui.unmount();
});
test('game publishes scene dialogue for reward, generation, gambling and title', async () => {
  for (const [status, gamble, scene] of [['ready', false, 'rewardSelect'], ['generating', false, 'generating'], ['generating', true, 'gamblePlay:chinchiro']]) {
    const session = { id: 'saved', betting_mode: 'count-v1', status, view: 'select', version: 1, text: '猫。', title: '物語', offers: [], lost_concepts: [], usage: {},
      analysis: { units: [{ id: 'cat', text: '猫', stakeable: true }, { id: 'end', text: '。', stakeable: false }] },
      transactions: gamble ? [{ id: 'r', status: 'generating', stakes: ['猫'], offer: { title: '報酬' }, gamble: { kind: 'chinchiro', strength: 1, outcome: null, rounds: [], moves: [] } }] : [] };
    global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/games') ? { games: [] } : drawStories(url) ?? session });
    const ui = mount(App, {}); await flush(); ui.draw();
    await startStory(ui);
    assertScene(ui, scene);
    assert.equal(ui.find(n => n.props['aria-label'] === 'タイトルへ'), undefined);
    ui.unmount();
  }
});
test('all dialogue owners publish and obsolete embedded frames are removed', () => {
  const anoma = fs.readFileSync('frontend/src/Anoma.tsx', 'utf8');
  const app = fs.readFileSync('frontend/src/App.tsx', 'utf8');
  const progress = fs.readFileSync('frontend/src/StoryProgress.tsx', 'utf8');
  assert.doesNotMatch(anoma, /StagePublisher lines=\{\[scenario.opening/);
  assert.match(app, /<ScenePublisher scene=\{gameScene/);
  assert.match(app, /<StagePublisher lines=\{\[reaction.line\]\} expression=\{reaction.expression\} reaction=\{reaction.reaction\}/);
  assert.match(progress, /<AnomaPortrait /);
  assert.doesNotMatch(anoma + app + progress, /AnomaFrame|AnomaResult/);
  const css = fs.readFileSync('frontend/src/notebook.css', 'utf8');
  assert.match(css, /\.anoma-dialogue\s*\{[^}]*font: 500/);
  assert.match(css, /\.anoma-stage\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
});
