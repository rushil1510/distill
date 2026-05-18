/**
 * Distill - Import rewriter
 *
 * After a function is moved from file A to file B, every other file in
 * the project that imports that function from A must be updated to
 * import it from B instead.
 *
 * This uses ts-morph's project-wide source file access to scan all
 * files and rewrite matching import declarations.
 */

import { Project, SourceFile } from 'ts-morph';
import * as path from 'path';
import type { ModifiedFile } from '../types';
import * as logger from '../utils/logger';
import micromatch from 'micromatch';

/** Describes a function that was moved to a new file. */
export interface MovedFunction {
  functionName: string;
  newFilePath: string;
  isDefaultExport?: boolean;
}

/**
 * Scan all source files in the project and rewrite imports that
 * referenced moved functions from the original file.
 *
 * @param project          - The ts-morph Project (has all source files loaded).
 * @param originalFilePath - Absolute path to the file functions were extracted from.
 * @param movedFunctions   - List of functions and their new file paths.
 * @param excludePatterns  - Glob patterns to skip (e.g., node_modules).
 * @returns Array of ModifiedFile records for files whose imports changed.
 */
export function rewriteImportsAcrossProject(
  project: Project,
  originalFilePath: string,
  movedFunctions: MovedFunction[],
  excludePatterns: string[]
): ModifiedFile[] {
  const modified: ModifiedFile[] = [];
  const sourceFiles = project.getSourceFiles();

  // Build a lookup: functionName → newFilePath
  const moveMap = new Map<string, string>();
  let movedDefaultExportFile: string | undefined;
  for (const mf of movedFunctions) {
    moveMap.set(mf.functionName, mf.newFilePath);
    if (mf.isDefaultExport) {
      movedDefaultExportFile = mf.newFilePath;
    }
  }

  // Compute all possible module specifier forms for the original file
  // (consumers might import with or without extension, with aliases, etc.)
  const originalAbsolute = path.resolve(originalFilePath);

  for (const sf of sourceFiles) {
    const sfPath = sf.getFilePath();

    // Skip the original file itself (already handled by extractor)
    if (path.resolve(sfPath) === originalAbsolute) continue;

    // Skip excluded patterns
    if (shouldExclude(sfPath, excludePatterns)) continue;

    const originalContent = sf.getFullText();
    let fileWasModified = false;

    // Check each import declaration in this file
    for (const importDecl of sf.getImportDeclarations()) {
      const moduleSpec = importDecl.getModuleSpecifierValue();

      // Resolve the import to an absolute path to compare with originalFilePath
      if (!doesImportPointToFile(sf, importDecl, originalAbsolute)) {
        continue;
      }

      // This import points to the original file. Check if any named imports
      // match moved functions.
      const namedImports = importDecl.getNamedImports();
      const movedNames: string[] = [];
      const remainingNames: string[] = [];

      for (const ni of namedImports) {
        const name = ni.getName();
        if (moveMap.has(name)) {
          movedNames.push(name);
        } else {
          remainingNames.push(ni.getText());
        }
      }

      // Also check default import
      const defaultImport = importDecl.getDefaultImport();
      let movedDefault: string | undefined;
      // If the original file's default export was moved, this default import refers to it,
      // regardless of the local name it was given in this file.
      if (defaultImport && movedDefaultExportFile) {
        movedDefault = defaultImport.getText();
      }

      if (movedNames.length === 0 && !movedDefault) continue;

      // We have imports to rewrite!
      fileWasModified = true;

      // Group moved functions by their new file (in case multiple go to different files)
      const byNewFile = new Map<string, string[]>();
      for (const name of movedNames) {
        const newFile = moveMap.get(name)!;
        if (!byNewFile.has(newFile)) byNewFile.set(newFile, []);
        byNewFile.get(newFile)!.push(name);
      }

      // Update the existing import: keep only the remaining names
      if (remainingNames.length > 0 && !movedDefault) {
        // Remove the moved named imports, keep the rest
        for (const ni of namedImports) {
          if (movedNames.includes(ni.getName())) {
            ni.remove();
          }
        }
      } else if (remainingNames.length === 0 && !movedDefault) {
        // All named imports were moved - remove the entire import declaration
        importDecl.remove();
      } else if (movedDefault) {
        // Default import was moved - this is more complex, remove entire import
        // and re-add without the default (if there are remaining named imports)
        importDecl.remove();
        if (remainingNames.length > 0) {
          sf.addImportDeclaration({
            moduleSpecifier: moduleSpec,
            namedImports: remainingNames,
          });
        }
      }

      // Add new import declarations pointing to the new files
      for (const [newFile, names] of byNewFile) {
        const relPath = computeRelativeImportPath(sfPath, newFile);
        sf.addImportDeclaration({
          moduleSpecifier: relPath,
          namedImports: names,
        });
      }

      if (movedDefault && movedDefaultExportFile) {
        const relPath = computeRelativeImportPath(sfPath, movedDefaultExportFile);
        sf.addImportDeclaration({
          moduleSpecifier: relPath,
          defaultImport: movedDefault,
        });
      }
    }

    if (fileWasModified) {
      modified.push({
        path: sfPath,
        originalContent,
        newContent: sf.getFullText(),
      });
    }
  }

  if (modified.length > 0) {
    logger.info(`Rewrote imports in ${modified.length} file(s)`);
  }

  return modified;
}

/**
 * Check if an import module specifier resolves to a given absolute file path.
 * Uses ts-morph's AST resolution which natively handles path aliases (@/utils)
 * and relative imports.
 */
function doesImportPointToFile(
  sourceFile: SourceFile,
  importDecl: import('ts-morph').ImportDeclaration,
  targetAbsolutePath: string
): boolean {
  const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
  if (moduleSourceFile) {
    if (moduleSourceFile.getFilePath() === targetAbsolutePath) return true;
  }

  // Fallback for when ts-morph can't resolve it (e.g. extensionless js in some configs)
  const moduleSpecifier = importDecl.getModuleSpecifierValue();
  if (!moduleSpecifier.startsWith('.')) return false;

  const importingDir = path.dirname(sourceFile.getFilePath());
  const resolved = path.resolve(importingDir, moduleSpecifier);

  // Try with common extensions
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  const targetBase = targetAbsolutePath.replace(/\.(ts|tsx|js|jsx)$/, '');

  for (const ext of extensions) {
    const resolvedWithExt = resolved.replace(/\.(ts|tsx|js|jsx)$/, '') + ext;
    if (resolvedWithExt === targetAbsolutePath || resolved.replace(/\.(ts|tsx|js|jsx)$/, '') === targetBase) {
      return true;
    }
  }

  return false;
}

/**
 * Compute the relative import path from one file to another,
 * without the file extension (standard TS/JS convention).
 */
function computeRelativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = path.dirname(fromFile);
  let relative = path.relative(fromDir, toFile).replace(/\\/g, '/');
  // Remove extension
  relative = relative.replace(/\.(ts|tsx|js|jsx)$/, '');
  if (!relative.startsWith('.')) relative = './' + relative;
  return relative;
}

/**
 * Check if a file path matches any of the exclude patterns.
 * Uses micromatch for glob support.
 */
function shouldExclude(filePath: string, patterns: string[]): boolean {
  return micromatch.isMatch(filePath, patterns);
}
