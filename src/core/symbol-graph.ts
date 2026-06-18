/**
 * Distill - Symbol graph builder
 *
 * The dependency-analyzer answers "what travels with ONE function." This
 * module answers a broader question: across an ENTIRE file, which top-level
 * symbols reference which other top-level symbols?
 *
 * The result is an intra-file dependency graph. Feeding that graph through
 * union-find connected-components (see clusterer.ts) reveals "responsibility
 * clusters" — groups of symbols that belong together but are independent of
 * the rest of the file. Each independent cluster is a candidate module to
 * extract, which is the foundation of the `distill suggest` command.
 *
 * We reuse the exact reference-collection helpers from the dependency
 * analyzer so the edges drawn here have the same semantics as the edges the
 * extraction pipeline already trusts.
 */

import { SourceFile, Node, SyntaxKind } from 'ts-morph';
import {
  collectReferencedIdentifiers,
  removeParameterNames,
} from './dependency-analyzer';
import type { FileSymbol, SymbolGraph, SymbolKind } from '../types';

/**
 * Build the intra-file symbol dependency graph for a source file.
 *
 * Only top-level declarations are treated as nodes. An edge is drawn from
 * symbol A to symbol B when A's declaration references B's name (and B is
 * also a top-level symbol in the same file). Imports, parameters, and
 * locally-scoped names are excluded — those don't connect two file-level
 * symbols.
 *
 * @param sourceFile - The ts-morph SourceFile to analyze.
 * @returns A SymbolGraph of in-file symbols and their reference edges.
 */
export function buildSymbolGraph(sourceFile: SourceFile): SymbolGraph {
  // ── 1. Enumerate every top-level symbol and remember its defining node ──
  const symbols = new Map<string, FileSymbol>();
  const nodes = new Map<string, Node>();

  for (const { name, kind, node } of collectTopLevelDeclarations(sourceFile)) {
    // First declaration wins (TS forbids duplicate top-level names anyway,
    // apart from overloads/merges we intentionally collapse to one node).
    if (symbols.has(name)) continue;

    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();

    symbols.set(name, {
      name,
      kind,
      isExported: isExported(node),
      startLine,
      endLine,
      lineCount: endLine - startLine + 1,
    });
    nodes.set(name, node);
  }

  // ── 2. Draw edges between symbols that reference each other ─────────────
  const edges = new Map<string, Set<string>>();
  for (const name of symbols.keys()) {
    edges.set(name, new Set<string>());
  }

  for (const [name, node] of nodes) {
    const referenced = collectReferencedIdentifiers(node);
    // Strip the symbol's own name and any locally-scoped parameter names so
    // a parameter that happens to shadow a file-level symbol doesn't create
    // a spurious edge.
    referenced.delete(name);
    removeParameterNames(node, referenced);

    for (const ref of referenced) {
      if (ref !== name && symbols.has(ref)) {
        edges.get(name)!.add(ref);
      }
    }
  }

  return { symbols, edges };
}

/** A raw top-level declaration discovered in a file. */
interface TopLevelDecl {
  name: string;
  kind: SymbolKind;
  node: Node;
}

/**
 * Collect every named top-level declaration in a file: functions, variable
 * statements (one entry per declared name), type aliases, interfaces, enums,
 * and classes.
 */
function collectTopLevelDeclarations(sourceFile: SourceFile): TopLevelDecl[] {
  const decls: TopLevelDecl[] = [];

  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (name) decls.push({ name, kind: 'function', node: func });
  }

  // For variable statements, the statement node carries the export keyword
  // and the full initializer body, so we anchor on it (one symbol per
  // declared name within the statement).
  for (const varStatement of sourceFile.getVariableStatements()) {
    for (const decl of varStatement.getDeclarations()) {
      const init = decl.getInitializer();
      const isFunc =
        init &&
        (init.getKind() === SyntaxKind.ArrowFunction ||
          init.getKind() === SyntaxKind.FunctionExpression);
      decls.push({
        name: decl.getName(),
        kind: isFunc ? 'function' : 'variable',
        node: varStatement,
      });
    }
  }

  for (const typeAlias of sourceFile.getTypeAliases()) {
    decls.push({ name: typeAlias.getName(), kind: 'type', node: typeAlias });
  }
  for (const iface of sourceFile.getInterfaces()) {
    decls.push({ name: iface.getName(), kind: 'interface', node: iface });
  }
  for (const enumDecl of sourceFile.getEnums()) {
    decls.push({ name: enumDecl.getName(), kind: 'enum', node: enumDecl });
  }
  for (const classDecl of sourceFile.getClasses()) {
    const name = classDecl.getName();
    if (name) decls.push({ name, kind: 'class', node: classDecl });
  }

  return decls;
}

/** Whether a top-level declaration node carries the `export` keyword. */
function isExported(node: Node): boolean {
  const fn = (node as any).isExported;
  return typeof fn === 'function' ? Boolean(fn.call(node)) : false;
}
