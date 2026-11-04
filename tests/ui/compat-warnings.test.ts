import { describe, expect, test } from 'bun:test';
import { compatWarnings, isGeckoBrowser } from '../../src/ui/compat-warnings.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const LIBREWOLF = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0 LibreWolf/140.0';

describe('compat warnings', () => {
  test('detects Gecko browsers without matching "like Gecko"', () => {
    expect([CHROME, SAFARI].map(isGeckoBrowser)).toEqual([false, false]);
    expect([FIREFOX, LIBREWOLF].map(isGeckoBrowser)).toEqual([true, true]);
  });

  test('warns only for a changed font scale', () => {
    expect(compatWarnings('1', CHROME)).toEqual([]);
    expect(compatWarnings(' 1.00', CHROME)).toEqual([]);
    expect(compatWarnings('', CHROME)).toEqual([]);
    expect(compatWarnings('1.5', CHROME)).toHaveLength(1);
    expect(compatWarnings('0.9', CHROME)[0]).toContain('font scale');
  });

  test('warns on Firefox and reports both conditions together', () => {
    expect(compatWarnings('1', FIREFOX)[0]).toContain('Firefox');
    expect(compatWarnings('1.5', FIREFOX)).toHaveLength(2);
  });
});
