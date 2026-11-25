// React detaches this ref before removing the keyed surface. Only the live
// surface owns handlers, focus, stage publishers and game state.
const exits = new WeakMap<HTMLElement, HTMLElement>();

export function retainExit(node: HTMLElement | null) {
  if (!node) return;
  // Strict Mode can detach and reattach the same live node.
  exits.get(node)?.remove();
  return () => {
    const host = node.parentElement;
    if (!host || !node.offsetHeight) return;
    host.querySelector(':scope > [data-exiting]')?.remove();
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-exiting]').forEach(child => child.remove());
    copy.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.dataset.exiting = '';
    Object.assign(copy.style, {
      position: 'absolute', top: node.offsetTop + 'px', left: node.offsetLeft + 'px',
      width: node.offsetWidth + 'px', height: node.offsetHeight + 'px', margin: '0',
    });
    exits.set(node, copy);
    host.append(copy);
    const finish = (event: AnimationEvent) => {
      if (event.target === copy) copy.remove();
    };
    copy.addEventListener('animationend', finish);
    copy.addEventListener('animationcancel', finish);
  };
}
