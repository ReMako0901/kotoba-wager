const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { stageMount } = require('./anoma-stage-harness.cjs');
const { StoryDecision, NormalEnding } = require('../src/StoryProgress.tsx');
const { normalEnding, normalEndings, extensionWelcome } = require('../src/scenario.ts');
const progress = (phase, difference=1) => ({ phase, totals: { rounds: 5, gained: 3, lost: 2, difference }, extension_start: 5 });

test('all S2/S3 lines are confirmed and endings use only the sign', () => {
  const design = fs.readFileSync('docs/STORY_DESIGN.md', 'utf8');
  for (const line of [...Object.values(normalEndings).flat(), ...extensionWelcome]) assert.ok(design.includes(line), line);
  for (const value of [1, 20]) assert.deepEqual(normalEnding(value), normalEndings.positive);
  for (const value of [-1, -20]) assert.deepEqual(normalEnding(value), normalEndings.negative);
  assert.deepEqual(normalEnding(0), normalEndings.zero);
});
test('reach has totals and explicit choices; busy prevents double actions', () => {
  const choices = [];
  const props = { progress: progress('escapable'), busy: false, onChoice: c => choices.push(c) };
  const ui = stageMount(StoryDecision, props);
  assert.ok(ui.find(n => n.props?.className === 'story-counts'));
  assert.equal(ui.all(n => n.type === 'h2').length, 0);
  for (const label of ['獲得数', '喪失数', '差分', '+1個']) assert.ok(text(ui.tree).includes(label));
  ui.click('さらに賭ける'); ui.click('脱出する');
  assert.deepEqual(choices, ['continue', 'escape']);
  ui.draw({ ...props, busy: true });
  assert.ok(ui.all(n => n.type === 'button').every(n => n.props.disabled));
});
test('extension entrance uses both confirmed lines; later rounds allow escape', () => {
  const ui = stageMount(StoryDecision, { progress: progress('extension'), busy: false, onChoice() {} });
  for (const line of extensionWelcome) assert.ok(text(ui.tree).includes(line));
  assert.equal(ui.all(n => n.type === 'button').length, 1);
  ui.draw({ progress: { ...progress('extension', -2), totals: { rounds: 6, gained: 2, lost: 4, difference: -2 } }, busy: false, onChoice() {} });
  assert.ok(text(ui.tree).includes('脱出する'));
  assert.ok(!text(ui.tree).includes(extensionWelcome[0]));
});
test('ending renders all final lines and returns to title', () => {
  for (const difference of [-3, 0, 4]) {
    let title = false;
    const ui = stageMount(NormalEnding, { progress: progress('ended', difference), onTitle: () => title = true });
    for (const line of normalEnding(difference)) assert.ok(text(ui.tree).includes(line));
    ui.click('タイトルへ戻る'); assert.ok(title);
  }
});


test('App resumes reach for both modes, records choice, then excludes the ending from resume', async () => {
  const App = require('../src/App.tsx').default;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (const kind of ['rps', 'card_guess', 'dice', 'slot', 'blackjack', 'baccarat']) {
    const stored = new Map([['story-wager-session-count-v1', 'saved-story']]);
    global.localStorage = { getItem: k => stored.get(k) ?? null, setItem: (k,v) => stored.set(k,v), removeItem: k => stored.delete(k) };
    global.crypto = require('node:crypto').webcrypto;
    let saved = { id: 'saved-story', betting_mode: 'count-v1', title: '物語', text: '猫が来た。', version: 6,
      status: 'ready', view: 'result', offers: [], lost_concepts: [], usage: {},
      transactions: [{ id: 'last', status: 'committed', outcome: 'win', before: '猫が来た。', after: '猫が来た。', stakes: ['猫'], lost: [], offer: { title: '報酬' }, gamble: { kind, strength: 1 } }],
      story_progress: progress('escapable') };
    const choices = [];
    global.fetch = async (url, options) => {
      if (url.endsWith('/games')) return { ok: true, json: async () => ({ games: [] }) };
      if (url.endsWith('/story-choice')) {
        const body = JSON.parse(options.body); choices.push(body);
        saved = { ...saved, story_progress: { ...saved.story_progress, phase: 'ended' } };
      }
      return { ok: true, json: async () => saved };
    };
    const ui = mount(App, {}); await flush(); ui.draw(); ui.draw();
    ui.click('つづきから'); await flush(); ui.draw();
    assert.ok(text(ui.tree).includes('さらに賭ける'), kind);
    assert.ok(!text(ui.tree).includes('次は何をねらう？'));
    ui.click('脱出する'); await flush(); ui.draw();
    assert.equal(choices[0].choice, 'escape');
    assert.equal(choices[0].version, 6);
    assert.ok(text(ui.tree).includes('ノーマルエンディング'));
    assert.equal(stored.has('story-wager-session-count-v1'), false);
    ui.click('タイトルへ戻る');
    assert.ok(!text(ui.tree).includes('つづきから'));
  }
});
