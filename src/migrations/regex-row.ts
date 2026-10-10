// Spindle regex rows surface JSON columns in whatever shape the host row
// carries: `target` arrives as an array (sometimes a JSON-encoded string),
// never a bare scalar. Scalar equality gates silently no-op entire steps.
export function regexRowTargetsDisplay(target: unknown): boolean {
  if (target === 'display') return true;
  if (Array.isArray(target)) return target.includes('display');
  if (typeof target === 'string') return target.includes('"display"');
  return false;
}
