/**
 * Distill - Dependency analyzer
 *
 * When extracting a function to its own file, we need to figure out
 * what "comes with it." This module walks the function's AST body and
 * identifies:
 *
 *   1. In-file dependencies - other symbols defined in the same file
 *      that the function references (e.g., helper functions, constants).
 *      These must either be co-extracted or imported into the new file.
 *
 *   2. Required imports - import statements from the original file that
 *      the function's body actually uses. These must be copied to the
 *      new file.
 *
 * This is the trickiest part of the extraction pipeline. Getting it
 * wrong means the extracted file won't compile.
 */

import {
  SourceFile,
  FunctionDeclaration,
  VariableStatement,
  Node,
  SyntaxKind,
  Identifier,
  ImportDeclaration,
} from 'ts-morph';
import type { DependencyReport, InFileDependency, RequiredImport } from '../types';

/**
 * Analyze all dependencies of a function that must travel with it
 * to a new file.
 *
 * @param sourceFile   - The source file containing the function.
 * @param functionName - The name of the function to analyze.
 * @returns A DependencyReport listing in-file deps and required imports.
 */
export function analyzeDependencies(
  sourceFile: SourceFile,
  functionName: string
): DependencyReport {
  // Find the function node
  const funcNode = findFunctionNode(sourceFile, functionName);
  if (!funcNode) {
    throw new Error(`Function "${functionName}" not found in ${sourceFile.getFilePath()}`);
  }

  // Collect all identifiers referenced inside the function body
  const initialReferencedNames = collectReferencedIdentifiers(funcNode);

  // Remove the function's own name and its parameters from the set
  initialReferencedNames.delete(functionName);
  removeParameterNames(funcNode, initialReferencedNames);

  // Recursively find transitive dependencies
  const referencedNames = expandTransitiveDependencies(sourceFile, initialReferencedNames, functionName);

  // Classify each referenced name
  const inFileDeps = findInFileDependencies(sourceFile, referencedNames, functionName);
  const requiredImports = findRequiredImports(sourceFile, referencedNames);

  return { inFileDeps, requiredImports };
}

/**
 * Find the AST node for a function by name.
 * Checks both FunctionDeclarations and VariableStatements (arrow/function expressions).
 */
function findFunctionNode(
  sourceFile: SourceFile,
  name: string
): FunctionDeclaration | VariableStatement | undefined {
  // Check function declarations first
  const funcDecl = sourceFile.getFunction(name);
  if (funcDecl) return funcDecl;

  // Check variable statements (const foo = () => ...)
  for (const varStatement of sourceFile.getVariableStatements()) {
    for (const decl of varStatement.getDeclarations()) {
      if (decl.getName() === name) {
        const init = decl.getInitializer();
        if (
          init &&
          (init.getKind() === SyntaxKind.ArrowFunction ||
            init.getKind() === SyntaxKind.FunctionExpression)
        ) {
          return varStatement;
        }
      }
    }
  }

  return undefined;
}

/**
 * Iteratively expand the set of referenced names by traversing into their definitions.
 */
function expandTransitiveDependencies(
  sourceFile: SourceFile,
  names: Set<string>,
  excludeName: string
): Set<string> {
  const expanded = new Set(names);
  const queue = Array.from(names);
  const processed = new Set<string>();

  while (queue.length > 0) {
    const currentName = queue.shift()!;
    if (processed.has(currentName)) continue;
    processed.add(currentName);
    if (currentName === excludeName) continue;

    const node = findNodeForName(sourceFile, currentName);
    if (node) {
      const newNames = collectReferencedIdentifiers(node);
      removeParameterNames(node, newNames);
      newNames.delete(currentName);

      for (const name of newNames) {
        if (!expanded.has(name) && name !== excludeName) {
          expanded.add(name);
          queue.push(name);
        }
      }
    }
  }

  return expanded;
}

/**
 * Find the AST node defining a given name.
 *
 * Exported so the symbol-graph builder can reuse the exact same
 * name→declaration resolution used by the extraction pipeline.
 */
export function findNodeForName(sourceFile: SourceFile, name: string): Node | undefined {
  const func = sourceFile.getFunction(name);
  if (func) return func;

  const varDecl = sourceFile.getVariableDeclaration(name);
  if (varDecl) return varDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement) || varDecl;

  const typeAlias = sourceFile.getTypeAlias(name);
  if (typeAlias) return typeAlias;

  const iface = sourceFile.getInterface(name);
  if (iface) return iface;

  const enumDecl = sourceFile.getEnum(name);
  if (enumDecl) return enumDecl;

  const classDecl = sourceFile.getClass(name);
  if (classDecl) return classDecl;

  return undefined;
}

/**
 * Walk the function's AST and collect every Identifier that's referenced.
 * We then check which of these are defined elsewhere in the file vs. imported.
 *
 * Exported for reuse by the symbol-graph builder, which needs the same
 * reference-collection semantics to draw edges between in-file symbols.
 */
export function collectReferencedIdentifiers(node: Node): Set<string> {
  const names = new Set<string>();

  node.forEachDescendant((child) => {
    if (child.getKind() === SyntaxKind.Identifier) {
      const parent = child.getParent();

      // Skip identifiers that are property accesses (e.g., obj.prop - we don't
      // need to track 'prop', only 'obj')
      if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = parent;
        // Only include the left-hand side (the object), not the property name
        if (child === (propAccess as any).getNameNode?.()) {
          return;
        }
      }

      // Skip identifiers in import declarations (they're declarations, not references)
      if (isInsideImportDeclaration(child)) {
        return;
      }

      names.add((child as Identifier).getText());
    }
  });

  return names;
}

/**
 * Check if a node is inside an ImportDeclaration.
 */
function isInsideImportDeclaration(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.getKind() === SyntaxKind.ImportDeclaration) return true;
    current = current.getParent();
  }
  return false;
}

/**
 * Remove function parameter names from the referenced set.
 * Parameters are locally scoped - they don't need to be imported.
 *
 * Exported so the symbol-graph builder can strip locally-scoped
 * parameter names before drawing edges between in-file symbols.
 */
export function removeParameterNames(node: Node, names: Set<string>): void {
  // For FunctionDeclaration: get parameters directly
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const funcDecl = node as FunctionDeclaration;
    for (const param of funcDecl.getParameters()) {
      names.delete(param.getName());
    }
    // Also remove type parameter names
    for (const tp of funcDecl.getTypeParameters()) {
      names.delete(tp.getName());
    }
    return;
  }

  // For VariableStatement containing arrow/function expression:
  // Drill into the initializer to find parameters
  if (node.getKind() === SyntaxKind.VariableStatement) {
    const varStatement = node as VariableStatement;
    for (const decl of varStatement.getDeclarations()) {
      const init = decl.getInitializer();
      if (init) {
        // ArrowFunction and FunctionExpression both have getParameters()
        const params = (init as any).getParameters?.();
        if (params) {
          for (const param of params) {
            names.delete(param.getName());
          }
        }
        const typeParams = (init as any).getTypeParameters?.();
        if (typeParams) {
          for (const tp of typeParams) {
            names.delete(tp.getName());
          }
        }
      }
    }
  }
}

/**
 * Find symbols defined in the same file that the function references.
 * These are "in-file dependencies" that need to be co-extracted or imported.
 */
function findInFileDependencies(
  sourceFile: SourceFile,
  referencedNames: Set<string>,
  excludeName: string
): InFileDependency[] {
  const deps: InFileDependency[] = [];

  for (const name of referencedNames) {
    if (name === excludeName) continue;

    // Check for function declarations
    const func = sourceFile.getFunction(name);
    if (func) {
      deps.push({
        name,
        kind: 'function',
        declarationText: func.getFullText().trim(),
        startLine: func.getStartLineNumber(),
        endLine: func.getEndLineNumber(),
      });
      continue;
    }

    // Check for variable declarations (constants, etc.)
    const varDecl = sourceFile.getVariableDeclaration(name);
    if (varDecl) {
      const varStatement = varDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (varStatement) {
        const init = varDecl.getInitializer();
        const isFunc =
          init &&
          (init.getKind() === SyntaxKind.ArrowFunction ||
            init.getKind() === SyntaxKind.FunctionExpression);

        deps.push({
          name,
          kind: isFunc ? 'function' : 'variable',
          declarationText: varStatement.getFullText().trim(),
          startLine: varStatement.getStartLineNumber(),
          endLine: varStatement.getEndLineNumber(),
        });
      }
      continue;
    }

    // Check for type aliases
    const typeAlias = sourceFile.getTypeAlias(name);
    if (typeAlias) {
      deps.push({
        name,
        kind: 'type',
        declarationText: typeAlias.getFullText().trim(),
        startLine: typeAlias.getStartLineNumber(),
        endLine: typeAlias.getEndLineNumber(),
      });
      continue;
    }

    // Check for interfaces
    const iface = sourceFile.getInterface(name);
    if (iface) {
      deps.push({
        name,
        kind: 'interface',
        declarationText: iface.getFullText().trim(),
        startLine: iface.getStartLineNumber(),
        endLine: iface.getEndLineNumber(),
      });
      continue;
    }

    // Check for enums
    const enumDecl = sourceFile.getEnum(name);
    if (enumDecl) {
      deps.push({
        name,
        kind: 'enum',
        declarationText: enumDecl.getFullText().trim(),
        startLine: enumDecl.getStartLineNumber(),
        endLine: enumDecl.getEndLineNumber(),
      });
      continue;
    }

    // Check for classes
    const classDecl = sourceFile.getClass(name);
    if (classDecl) {
      deps.push({
        name,
        kind: 'class',
        declarationText: classDecl.getFullText().trim(),
        startLine: classDecl.getStartLineNumber(),
        endLine: classDecl.getEndLineNumber(),
      });
      continue;
    }
  }

  return deps;
}

/**
 * Find which import statements from the original file are needed by
 * the extracted function.
 *
 * For each import in the file, we check if any of its imported names
 * are in our `referencedNames` set. If so, we include that import
 * (but only the specific named imports that are actually used).
 */
function findRequiredImports(
  sourceFile: SourceFile,
  referencedNames: Set<string>
): RequiredImport[] {
  const imports: RequiredImport[] = [];

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const usedNamedImports: string[] = [];
    let usedDefaultImport: string | undefined;
    let usedNamespaceImport: string | undefined;
    const isTypeOnly = importDecl.isTypeOnly();

    // Check default import
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport && referencedNames.has(defaultImport.getText())) {
      usedDefaultImport = defaultImport.getText();
    }

    // Check namespace import (import * as foo from ...)
    const namespaceImport = importDecl.getNamespaceImport();
    if (namespaceImport && referencedNames.has(namespaceImport.getText())) {
      usedNamespaceImport = namespaceImport.getText();
    }

    // Check named imports
    for (const namedImport of importDecl.getNamedImports()) {
      const importedName = namedImport.getAliasNode()?.getText() || namedImport.getName();
      if (referencedNames.has(importedName)) {
        // Use the full import specifier text (preserves aliases like `foo as bar`)
        usedNamedImports.push(namedImport.getText());
      }
    }

    // Only include this import if at least one symbol is used
    if (usedDefaultImport || usedNamespaceImport || usedNamedImports.length > 0) {
      imports.push({
        moduleSpecifier,
        namedImports: usedNamedImports,
        defaultImport: usedDefaultImport,
        namespaceImport: usedNamespaceImport,
        isTypeOnly,
      });
    }
  }

  return imports;
}
