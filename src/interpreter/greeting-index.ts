/** Convert Lumiverse's [default, ...alternates] index to Risu's fmIndex. */
export function toRisuFirstMessageIndex(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value - 1
    : -1;
}
