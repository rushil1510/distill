/**
 * Distill - Function analyzer
 *
 * Scans a source file's AST and produces a list of FunctionInfo objects
 * describing every top-level function. This powers both the `analyze`
 * command (showing what's extractable) and the `extract` command
 * (finding the target function by name or pattern).
 *
 * Supported declarations:
 *   - `function foo() {}`          → kind: 'function'
 *   - `export function foo() {}`   → kind: 'function', isExported: true
 *   - `const foo = () => {}`       → kind: 'arrow'
 *   - `const foo = function() {}`  → kind: 'function-expression'
 *   - `export default function() {}` → kind: 'function', isDefaultExport: true
 */

import {
  SourceFile,
  FunctionDeclaration,
  VariableStatement,
  SyntaxKind,
  Node,
} from 'ts-morph';
import type { FunctionInfo } from '../types';

/**
 * Analyze a source file and return info about all top-level functions.
 *
 * @param sourceFile - The ts-morph SourceFile to analyze.
 * @returns Array of FunctionInfo describing each extractable function.
 */
export function analyzeFunctions(sourceFile: SourceFile): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  // ── 1. Named function declarations ──────────────────────────────
  // e.g., `function calculateTax(amount: number) { ... }`
  // e.g., `export function calculateTax(amount: number) { ... }`
  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (!name) continue; // Skip anonymous functions at top level

    results.push(buildFunctionInfo(func, name, 'function'));
  }

  // ── 2. Arrow functions and function expressions assigned to const/let ─
  // e.g., `const formatPrice = (n: number) => ...`
  // e.g., `export const formatPrice = function(n: number) { ... }`
  for (const varStatement of sourceFile.getVariableStatements()) {
    for (const decl of varStatement.getDeclarations()) {
      const initializer = decl.getInitializer();
      if (!initializer) continue;

      const kind = initializer.getKind();
      if (kind === SyntaxKind.ArrowFunction) {
        results.push(
          buildFunctionInfoFromVar(varStatement, decl.getName(), 'arrow')
        );
      } else if (kind === SyntaxKind.FunctionExpression) {
        results.push(
          buildFunctionInfoFromVar(varStatement, decl.getName(), 'function-expression')
        );
      }
    }
  }

  return results;
}

/**
 * Build a FunctionInfo from a FunctionDeclaration node.
 */
function buildFunctionInfo(
  node: FunctionDeclaration,
  name: string,
  kind: FunctionInfo['kind']
): FunctionInfo {
  const startLine = node.getStartLineNumber();
  const endLine = node.getEndLineNumber();

  return {
    name,
    kind,
    isExported: node.isExported(),
    isDefaultExport: node.isDefaultExport(),
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    jsdoc: getLeadingJsDoc(node),
  };
}

/**
 * Build a FunctionInfo from a VariableStatement containing an arrow/function expression.
 * We use the VariableStatement (not the VariableDeclaration) because it carries
 * the export keyword and JSDoc comment.
 */
function buildFunctionInfoFromVar(
  varStatement: VariableStatement,
  name: string,
  kind: FunctionInfo['kind']
): FunctionInfo {
  const startLine = varStatement.getStartLineNumber();
  const endLine = varStatement.getEndLineNumber();

  return {
    name,
    kind,
    isExported: varStatement.isExported(),
    isDefaultExport: varStatement.isDefaultExport(),
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    jsdoc: getLeadingJsDoc(varStatement),
  };
}

/**
 * Extract the leading JSDoc comment text from a node, if present.
 * Returns undefined if no JSDoc is found.
 */
function getLeadingJsDoc(node: Node): string | undefined {
  const jsDocs = (node as any).getJsDocs?.();
  if (jsDocs && jsDocs.length > 0) {
    return jsDocs[0].getFullText().trim();
  }
  return undefined;
}
