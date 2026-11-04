const FONT_SCALE_VAR = '--lumiverse-font-scale';

export function isGeckoBrowser(userAgent: string): boolean {
  // Chromium and WebKit say "like Gecko" with no build number, Firefox and its forks say "Gecko/20100101".
  return /\bGecko\/\d/.test(userAgent);
}

export function compatWarnings(fontScale: string, userAgent: string): string[] {
  const warnings: string[] = [];
  const scale = Number.parseFloat(fontScale);
  if (Number.isFinite(scale) && Math.abs(scale - 1) > 0.001) {
    warnings.push('You have changed your font scale. Changing font scale can cause RisuAI text to render wrongly! Be aware.');
  }
  if (isGeckoBrowser(userAgent)) {
    warnings.push('Firefox runs LumiRealm ~100x slower than Chromium based browsers. Please switch.');
  }
  return warnings;
}

export function mountCompatWarnings(parent: HTMLElement, before: Node | null): () => void {
  const list = document.createElement('div');
  list.className = 'lr-compat-warnings';
  list.setAttribute('role', 'status');
  parent.insertBefore(list, before);
  let shown = '';
  const refresh = (): void => {
    const fontScale = getComputedStyle(document.documentElement).getPropertyValue(FONT_SCALE_VAR);
    const warnings = compatWarnings(fontScale, navigator.userAgent);
    const next = warnings.join('\n');
    if (next === shown) return;
    shown = next;
    list.replaceChildren(...warnings.map((text) => {
      const item = document.createElement('div');
      item.className = 'lr-compat-warning';
      item.textContent = text;
      return item;
    }));
    list.hidden = warnings.length === 0;
  };
  list.hidden = true;
  refresh();
  // The host writes theme variables as inline styles on the root element.
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  return () => {
    observer.disconnect();
    list.remove();
  };
}
