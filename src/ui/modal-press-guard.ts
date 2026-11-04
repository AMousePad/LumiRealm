// The host dismisses on any backdrop click, and a press released outside the dialog clicks their common ancestor, the backdrop.
export function guardModalPressRelease(root: HTMLElement): () => void {
  let pressTarget: EventTarget | null = null;
  const onPress = (event: Event): void => { pressTarget = event.composedPath()[0] ?? null; };
  const onClick = (event: Event): void => {
    const target = event.target;
    if (target !== pressTarget && target instanceof Node && target !== root && target.contains(root)) event.stopPropagation();
  };
  window.addEventListener('pointerdown', onPress, true);
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('pointerdown', onPress, true);
    window.removeEventListener('click', onClick, true);
  };
}
