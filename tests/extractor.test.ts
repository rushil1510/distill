import { describe, it, expect } from 'vitest';
import { ensureExported } from '../src/core/extractor';

/**
 * Regression coverage for the `export` insertion logic used when building a new
 * extracted file. The original implementation blindly prepended `export ` to a
 * declaration's full text. Because `getFullText()` includes leading comments /
 * JSDoc, that produced invalid output like `export // @internal\nexport const x`,
 * which forced a tsc rollback on virtually any commented symbol.
 */
describe('ensureExported', () => {
  it('adds export to a bare declaration', () => {
    expect(ensureExported('const x = 1;')).toBe('export const x = 1;');
  });

  it('does not double-export an already-exported declaration', () => {
    expect(ensureExported('export const x = 1;')).toBe('export const x = 1;');
  });

  it('inserts export AFTER a leading line comment, not before it', () => {
    const input = '// @internal\nconst x = 1;';
    expect(ensureExported(input)).toBe('// @internal\nexport const x = 1;');
  });

  it('leaves an already-exported declaration with a leading comment untouched', () => {
    const input = '// @internal\nexport const x = 1;';
    expect(ensureExported(input)).toBe(input);
  });

  it('inserts export after a multi-line JSDoc block', () => {
    const input = '/**\n * docs\n */\nfunction foo() {}';
    expect(ensureExported(input)).toBe('/**\n * docs\n */\nexport function foo() {}');
  });

  it('never emits a double-export keyword on the declaration line', () => {
    const input = '//   @internal\nexport const isMatcher = (x) => x;';
    const out = ensureExported(input);
    expect(out.includes('export export')).toBe(false);
    expect(out.match(/export const/g)?.length).toBe(1);
  });
});
