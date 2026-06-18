/**
 * Tests for the symbol-graph builder, the union-find clusterer, and the
 * refactor suggester (the engine behind `distill suggest`).
 */

import { describe, it, expect } from 'vitest';
import { Project, SourceFile } from 'ts-morph';
import { buildSymbolGraph } from '../src/core/symbol-graph';
import { clusterSymbols } from '../src/core/clusterer';
import {
  suggestForFile,
  suggestForProject,
  computeScore,
  fanInForFile,
} from '../src/core/suggester';

/** Helper to create an in-memory source file for testing. */
function createSourceFile(code: string, fileName = 'test.ts'): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(fileName, code);
}

describe('buildSymbolGraph', () => {
  it('enumerates all top-level symbol kinds', () => {
    const sf = createSourceFile(`
      const A = 1;
      function f() { return A; }
      type T = number;
      interface I { x: number; }
      enum E { a, b }
      class C {}
    `);

    const graph = buildSymbolGraph(sf);
    const names = Array.from(graph.symbols.keys()).sort();
    expect(names).toEqual(['A', 'C', 'E', 'I', 'T', 'f']);
    expect(graph.symbols.get('T')!.kind).toBe('type');
    expect(graph.symbols.get('I')!.kind).toBe('interface');
    expect(graph.symbols.get('E')!.kind).toBe('enum');
    expect(graph.symbols.get('C')!.kind).toBe('class');
  });

  it('draws an edge when one symbol references another in-file symbol', () => {
    const sf = createSourceFile(`
      const RATE = 0.2;
      export function tax(n: number) { return n * RATE; }
    `);

    const graph = buildSymbolGraph(sf);
    expect(graph.edges.get('tax')!.has('RATE')).toBe(true);
    // RATE references nothing in-file.
    expect(graph.edges.get('RATE')!.size).toBe(0);
  });

  it('does not draw edges to imports or parameters', () => {
    const sf = createSourceFile(`
      import { readFileSync } from 'fs';
      export function load(readFileSync2: string) {
        return readFileSync(readFileSync2);
      }
    `);

    const graph = buildSymbolGraph(sf);
    // 'readFileSync' is imported (not a file symbol); the param is local.
    expect(graph.edges.get('load')!.size).toBe(0);
  });
});

describe('clusterSymbols', () => {
  it('groups mutually-referencing symbols and separates independent ones', () => {
    const sf = createSourceFile(`
      const TAX_RATE = 0.18;
      interface TaxResult { tax: number; }
      export function calculateTax(n: number): TaxResult {
        return { tax: n * TAX_RATE };
      }

      const SYMBOLS: Record<string, string> = { USD: '$' };
      export function formatPrice(n: number, c: string) {
        return SYMBOLS[c] + n;
      }
    `);

    const clusters = clusterSymbols(buildSymbolGraph(sf));
    expect(clusters).toHaveLength(2);

    const taxCluster = clusters.find((c) => c.symbols.includes('calculateTax'))!;
    expect(new Set(taxCluster.symbols)).toEqual(
      new Set(['TAX_RATE', 'TaxResult', 'calculateTax'])
    );

    const priceCluster = clusters.find((c) => c.symbols.includes('formatPrice'))!;
    expect(new Set(priceCluster.symbols)).toEqual(
      new Set(['SYMBOLS', 'formatPrice'])
    );
  });

  it('returns a single cluster for a fully cohesive file', () => {
    const sf = createSourceFile(`
      const A = 1;
      function b() { return A; }
      function c() { return b() + A; }
    `);

    const clusters = clusterSymbols(buildSymbolGraph(sf));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].symbols.sort()).toEqual(['A', 'b', 'c']);
  });

  it('sorts clusters largest-first by line count', () => {
    const sf = createSourceFile(`
      export function small() { return 1; }

      const X = 1;
      export function big() {
        const a = X;
        const b = a + 1;
        const c = b + 1;
        return c;
      }
    `);

    const clusters = clusterSymbols(buildSymbolGraph(sf));
    expect(clusters[0].symbols).toContain('big');
  });

  it('prefers an exported symbol for the suggested module name', () => {
    const sf = createSourceFile(`
      function helper() { return 1; }
      export function publicApi() { return helper(); }
    `);

    const clusters = clusterSymbols(buildSymbolGraph(sf), 'kebab-case');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].suggestedName).toBe('public-api');
    expect(clusters[0].hasExportedSymbol).toBe(true);
  });
});

describe('computeScore', () => {
  it('scores a cohesive (single-cluster) file at just its coupling', () => {
    // clusterCount of 1 → no split potential; only coupling contributes.
    expect(computeScore(500, 1, 3, 2)).toBe(5);
  });

  it('rewards large, fragmented files', () => {
    expect(computeScore(400, 4, 0, 0)).toBe(1200); // 400 * 3
  });

  it('adds coupling on top of split potential', () => {
    expect(computeScore(100, 2, 5, 4)).toBe(109); // 100 * 1 + 9
  });
});

describe('suggestForFile', () => {
  it('reports clusters, symbol count, and a non-zero score for a god-file', () => {
    const sf = createSourceFile(`
      const TAX_RATE = 0.18;
      export function calculateTax(n: number) { return n * TAX_RATE; }
      const SYMBOLS: Record<string, string> = { USD: '$' };
      export function formatPrice(n: number, c: string) { return SYMBOLS[c] + n; }
      export function clamp(v: number, lo: number, hi: number) {
        return Math.min(Math.max(v, lo), hi);
      }
    `);

    const result = suggestForFile(sf, { naming: 'camelCase', fanIn: 0 });
    expect(result.clusterCount).toBe(3);
    expect(result.symbolCount).toBe(5);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe('project scan (fan-in + ranking)', () => {
  function makeProject(): Project {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      '/proj/util.ts',
      `
        export const A = 1;
        export function one() { return A; }
        export const B = 2;
        export function two() { return B; }
      `
    );
    project.createSourceFile(
      '/proj/consumer.ts',
      `import { one, two } from './util';\nexport const z = one() + two();`
    );
    return project;
  }

  it('counts fan-in via real module resolution', () => {
    const project = makeProject();
    expect(fanInForFile(project, '/proj/util.ts')).toBe(1);
    expect(fanInForFile(project, '/proj/consumer.ts')).toBe(0);
  });

  it('ranks the fragmented file first and records coupling', () => {
    const project = makeProject();
    const suggestions = suggestForProject(project, {
      naming: 'camelCase',
      exclude: [],
    });

    expect(suggestions[0].filePath).toBe('/proj/util.ts');
    expect(suggestions[0].clusterCount).toBe(2);
    expect(suggestions[0].fanIn).toBe(1);
    expect(suggestions[0].fanOut).toBe(0);
  });
});
