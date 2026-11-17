const { createRequire } = require('node:module');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const local = createRequire(path.resolve(__dirname, '../package.json'));
const ts = local('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }, fileName: filename }).outputText, filename);
};
const { revealStep, revealDuration, isNearMiss, changeShapes } = require('../src/gamblePresentation.ts');
// Exercise the real component's state/effects with a deterministic clock and media query.
let values, cursor, effects, timers, reduced;
const actualLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'react' && /(?:GambleMotion|GamblePlay)\.tsx$/.test(parent.filename)) return {
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial;
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    useEffect(effect) { effects.push(effect); },
  };
  return actualLoad.call(this, name, parent, main);
};
const { GambleMotion, GenerationSkeleton } = require('../src/GambleMotion.tsx');
// Load the actual advanced players without Vite's asset URL or browser-only card UI.
const playerPath = path.resolve(__dirname, '../src/GamblePlay.tsx');
const playerModule = new Module(playerPath, module);
playerModule.filename = playerPath;
playerModule.paths = Module._nodeModulePaths(path.dirname(playerPath));
const motionLoad = Module._load;
Module._load = function(name, parent, main) {
  if (parent.filename === playerPath && name === './BeginnerPlay') return { BeginnerPlay() {} };
  if (parent.filename === playerPath && name === './BaccaratCard') return { CardFace() {}, BaccaratCard() {} };
  return motionLoad.call(this, name, parent, main);
};
playerModule._compile(ts.transpileModule(fs.readFileSync(playerPath, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"') +
  '\nexport const testPlayers = { slot: SlotPlay, blackjack: BlackjackPlay, baccarat: BaccaratPlay };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, playerPath);
Module._load = actualLoad;
const { testPlayers } = playerModule.exports;
function render(gamble, children) {
  cursor = 0; effects = []; timers = [];
  global.window = { matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  const tree = GambleMotion({ gamble, children });
  effects.forEach(effect => effect());
  return tree;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
}
for (const kind of Object.keys(changeShapes)) test(`${kind}: full playback, skip and reduced motion retain identical transaction and child result`, () => {
  for (const outcome of ['win', 'loss']) for (const mode of ['play', 'skip', 'reduce']) {
    const gamble = Object.freeze({ kind, outcome, strength: 8, reels: Object.freeze(['ベル', 'ベル', 'BIG']),
      rounds: Object.freeze([{ difference: 1 }]), moves: Object.freeze([{ face: 3 }]) });
    const transaction = Object.freeze({ gamble, outcome, strength: 8, after: '変更済みの本文。' });
    const original = JSON.stringify(transaction);
    const child = { type: 'output', props: { children: transaction.after } };
    values = []; reduced = mode === 'reduce';
    let tree = render(gamble, child);
    if (mode === 'skip') find(tree, n => n.type === 'button').props.onClick();
    for (let i = 0; i < 4 && !find(tree, n => n === child); i++) {
      if (mode === 'play') timers.forEach(fn => fn());
      tree = render(gamble, child);
    }
    assert.ok(find(tree, n => n === child));
    assert.equal(JSON.stringify(transaction), original);
  }
});
test('bounded timing and factual near misses only', () => {
  assert.equal(revealStep(revealDuration), 3);
  assert.equal(revealStep(0, true), 3); assert.equal(revealStep(0, false, true), 3);
  assert.equal(revealStep(-100), 0);
  assert.equal(isNearMiss({ kind: 'slot', outcome: 'loss', reels: ['A', 'A', 'B'] }), true);
  assert.equal(isNearMiss({ kind: 'slot', outcome: 'win', reels: ['A', 'A', 'A'] }), false);
  assert.equal(isNearMiss({ kind: 'slot', outcome: 'loss', reels: ['A', 'B', 'C'] }), false);
  assert.equal(isNearMiss({ kind: 'dice', outcome: 'loss', moves: [{ face: 2 }] }), false);
  assert.equal(isNearMiss({ kind: 'rps', outcome: 'loss' }), false);
});
test('waiting skeleton is explicitly busy and labels generation', () => {
  const tree = GenerationSkeleton();
  assert.equal(tree.props['aria-busy'], 'true'); assert.equal(tree.props.role, 'status');
  assert.ok(find(tree, n => n.props?.className === 'skeleton-paper'));
});
for (const [kind, Player] of Object.entries(testPlayers)) test(`${kind}: native playback and one-click skip finish with saved props and no API action`, () => {
  for (const outcome of ['win', 'loss']) for (const skip of [false, true]) {
    const card = Object.freeze({ rank: 'K', suit: '♠' });
    const cards = Object.freeze([card, card]);
    const gamble = Object.freeze({ kind, outcome, strength: 1, reels: Object.freeze(['ベル', 'ベル', 'BIG']),
      rounds: Object.freeze([Object.freeze({ player: cards, banker: cards, player_total: 0, banker_total: 1, difference: 1, outcome })]) });
    let calls = 0;
    const props = { gamble, prepared: true, busy: false, onFinish() { calls++; }, onMove() { calls++; } };
    const snapshot = JSON.stringify(gamble);
    values = []; reduced = false;
    function draw() {
      cursor = 0; effects = []; timers = [];
      const tree = Player(props);
      effects.forEach(effect => effect());
      return tree;
    }
    // Configure the same deterministic browser clock used by the motion component.
    render(gamble, null);
    values = [];
    let tree = draw();
    if (skip) find(tree, n => n.type === 'button' && n.props.children === '演出をスキップ').props.onClick();
    for (let i = 0; i < 5 && !find(tree, n => n.type?.name === 'Finish'); i++) {
      if (!skip) timers.forEach(fn => fn());
      tree = draw();
    }
    const finish = find(tree, n => n.type?.name === 'Finish');
    assert.ok(finish, 'playback must reach the real Finish component');
    assert.equal(finish.props.gamble, gamble);
    assert.equal(finish.props.onFinish, props.onFinish);
    assert.equal(JSON.stringify(gamble), snapshot);
    assert.equal(calls, 0, 'presentation must not submit moves or finish requests');
  }
});
