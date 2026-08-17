export function pickNativeFile(accept: readonly string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (file: File | null): void => {
      if (settled) return;
      settled = true;
      try { input.remove(); } catch { /* ignore */ }
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.item(0) ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
