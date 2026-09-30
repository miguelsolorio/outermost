// Hardware controls: pressing one with the mouse doesn't take keyboard focus,
// so Space still plays and pauses and the ship's keys keep flying (keyboard
// users still tab to it), a drag from it never selects text, and a touch
// drag on it never scrolls or zooms. The console's panels are hardware too.

export function hardware(node: HTMLElement): { destroy(): void } {
  const keep = (e: MouseEvent) => e.preventDefault();
  node.addEventListener('mousedown', keep);
  node.style.touchAction = 'none';
  return { destroy: () => node.removeEventListener('mousedown', keep) };
}

export const reducedMotion = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
