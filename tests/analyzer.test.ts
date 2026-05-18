/**
 * Tests for the function analyzer.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { analyzeFunctions } from '../src/core/analyzer';

/** Helper to create an in-memory source file for testing. */
function createSourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile('test.ts', code);
}

describe('analyzeFunctions', () => {
  it('finds named function declarations', () => {
    const sf = createSourceFile(`
      function hello() { return 'hi'; }
      function world() { return 'world'; }
    `);

    const results = analyzeFunctions(sf);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('hello');
    expect(results[0].kind).toBe('function');
    expect(results[1].name).toBe('world');
  });

  it('detects exported functions', () => {
    const sf = createSourceFile(`
      export function foo() {}
      function bar() {}
    `);

    const results = analyzeFunctions(sf);
    const foo = results.find(r => r.name === 'foo')!;
    const bar = results.find(r => r.name === 'bar')!;

    expect(foo.isExported).toBe(true);
    expect(bar.isExported).toBe(false);
  });

  it('finds arrow functions assigned to const', () => {
    const sf = createSourceFile(`
      const greet = (name: string) => 'Hello ' + name;
    `);

    const results = analyzeFunctions(sf);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('greet');
    expect(results[0].kind).toBe('arrow');
  });

  it('finds function expressions assigned to const', () => {
    const sf = createSourceFile(`
      const greet = function(name: string) { return 'Hello ' + name; };
    `);

    const results = analyzeFunctions(sf);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('greet');
    expect(results[0].kind).toBe('function-expression');
  });

  it('computes line counts correctly', () => {
    const sf = createSourceFile(`function multi() {
  const a = 1;
  const b = 2;
  return a + b;
}`);

    const results = analyzeFunctions(sf);
    expect(results[0].lineCount).toBe(5);
  });

  it('skips non-function variable declarations', () => {
    const sf = createSourceFile(`
      const x = 42;
      const y = 'hello';
      function foo() {}
    `);

    const results = analyzeFunctions(sf);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('foo');
  });

  it('handles exported arrow functions', () => {
    const sf = createSourceFile(`
      export const handler = () => { return 'ok'; };
    `);

    const results = analyzeFunctions(sf);
    expect(results).toHaveLength(1);
    expect(results[0].isExported).toBe(true);
    expect(results[0].kind).toBe('arrow');
  });
});
