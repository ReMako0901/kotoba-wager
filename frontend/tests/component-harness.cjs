// Real TSX components, deterministic hooks and clock. This does not emulate browser layout.
const { createRequire } = require('node:module');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const local = createRequire(path.resolve(__dirname, '../package.json'));
const ts = local('typescript');
let active;
const hooks = {
  useState(initial) {
    const state = active.state, i = active.cursor++;
    if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
  },
  useRef(initial) { return hooks.useState(() => ({ current: initial }))[0]; },
  useMemo(fn) { active.cursor++; return fn(); },
  useEffect(effect, deps) {
    const state = active.state, i = active.cursor++;
    const previous = state[i];
    if (!previous || !deps || deps.some((d, j) => !Object.is(d, previous.deps[j]))) {
      active.effects.push(() => { previous?.cleanup?.(); state[i] = { deps, cleanup: effect() }; });
    }
  },
};
hooks.useLayoutEffect = hooks.useEffect;
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'react' && parent.filename.includes('/frontend/src/')) return hooks;
  return load.call(this, name, parent, main);
};
require.extensions['.css'] = () => {};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"').replaceAll('import.meta.env.VITE_API_BASE_URL', '""');
  module._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }, fileName: filename }).outputText, filename);
};
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return [node.props?.children].flat(Infinity).map(text).join('');
}
function mount(Component, initialProps, reduced = false) {
  const instances = new Map(), timers = new Map(); let serial = 0, props = initialProps, tree;
  global.window = { matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    scrollTo() {},
    setInterval(fn) { const id = ++serial; const repeat = () => { fn(); timers.set(id, repeat); }; timers.set(id, repeat); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); } };
  global.requestAnimationFrame = fn => window.setTimeout(fn, 16);
  global.cancelAnimationFrame = id => window.clearTimeout(id);
  function expand(node, key, effects) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const identity = `${key}/${node.type.name}:${node.key ?? ''}`;
      if (!instances.has(identity)) instances.set(identity, []);
      active = { state: instances.get(identity), cursor: 0, effects };
      return expand(node.type(node.props), identity, effects);
    }
    if (node.type === 'dialog' && node.props.ref) node.props.ref.current = { showModal() {}, close() {} };
    // Only the shuffle needs a measured board. Leave canvas/layout refs unmounted.
    if (node.props?.className === 'guess-board' && node.props.ref) node.props.ref.current = { clientWidth: 300 };
    return { ...node, props: { ...node.props, children: [node.props?.children].flat(Infinity).map((child, i) => expand(child, `${key}/${i}`, effects)) } };
  }
  function draw(next = props) {
    props = next; const effects = [];
    tree = expand({ type: Component, props }, 'root', effects);
    effects.forEach(effect => effect());
    return tree;
  }
  const api = {
    draw,
    get tree() { return tree; },
    find: predicate => nodes(tree, predicate)[0],
    all: predicate => nodes(tree, predicate),
    click(label) {
      const button = nodes(tree, n => n.type === 'button' && (text(n).includes(label) || n.props['aria-label'] === label))[0];
      if (!button || button.props.disabled) throw new Error(`No enabled button: ${label}`);
      button.props.onClick(); return draw();
    },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); return draw(); },
  };
  draw(); return api;
}
module.exports = { mount, nodes, text, local };
