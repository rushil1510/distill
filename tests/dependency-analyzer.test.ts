/**
 * Tests for the dependency analyzer.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { analyzeDependencies } from '../src/core/dependency-analyzer';

/** Helper to create an in-memory source file for testing. */
function createSourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile('test.ts', code);
}

describe('analyzeDependencies', () => {
  it('finds in-file constant dependencies', () => {
    const sf = createSourceFile(`
const TAX_RATE = 0.18;

export function calculateTax(amount: number) {
  return amount * TAX_RATE;
}
    `);

    const deps = analyzeDependencies(sf, 'calculateTax');
    expect(deps.inFileDeps).toHaveLength(1);
    expect(deps.inFileDeps[0].name).toBe('TAX_RATE');
    expect(deps.inFileDeps[0].kind).toBe('variable');
  });

  it('finds in-file function dependencies', () => {
    const sf = createSourceFile(`
function validate(n: number) { return n >= 0; }

export function process(n: number) {
  if (!validate(n)) throw new Error('invalid');
  return n * 2;
}
    `);

    const deps = analyzeDependencies(sf, 'process');
    expect(deps.inFileDeps).toHaveLength(1);
    expect(deps.inFileDeps[0].name).toBe('validate');
    expect(deps.inFileDeps[0].kind).toBe('function');
  });

  it('finds required external imports', () => {
    const sf = createSourceFile(`
import { readFileSync } from 'fs';
import * as path from 'path';

export function loadConfig(p: string) {
  const abs = path.resolve(p);
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

export function unrelated() { return 42; }
    `);

    const deps = analyzeDependencies(sf, 'loadConfig');
    expect(deps.requiredImports).toHaveLength(2);

    const fsImport = deps.requiredImports.find(i => i.moduleSpecifier === 'fs');
    expect(fsImport).toBeDefined();
    expect(fsImport!.namedImports).toContain('readFileSync');

    const pathImport = deps.requiredImports.find(i => i.moduleSpecifier === 'path');
    expect(pathImport).toBeDefined();
    expect(pathImport!.namespaceImport).toBe('path');
  });

  it('does not include function parameters as dependencies', () => {
    const sf = createSourceFile(`
const UNRELATED = 'hello';

export function greet(name: string) {
  return 'Hi ' + name;
}
    `);

    const deps = analyzeDependencies(sf, 'greet');
    // 'name' is a parameter, not an in-file dep
    expect(deps.inFileDeps).toHaveLength(0);
    expect(deps.requiredImports).toHaveLength(0);
  });

  it('finds interface dependencies', () => {
    const sf = createSourceFile(`
interface Result { value: number; }

export function compute(): Result {
  return { value: 42 };
}
    `);

    const deps = analyzeDependencies(sf, 'compute');
    // Note: The identifier 'Result' appears in the return type annotation.
    // Our analyzer should find it if it's referenced in the function body/signature.
    // The current implementation scans all Identifiers in descendants.
    expect(deps.inFileDeps.some(d => d.name === 'Result')).toBe(true);
  });

  it('handles functions with no dependencies', () => {
    const sf = createSourceFile(`
export function add(a: number, b: number) {
  return a + b;
}
    `);

    const deps = analyzeDependencies(sf, 'add');
    expect(deps.inFileDeps).toHaveLength(0);
    expect(deps.requiredImports).toHaveLength(0);
  });
});
