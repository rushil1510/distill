/**
 * Distill - Function extractor (core orchestrator)
 *
 * Orchestrates the full extraction pipeline:
 *   1. Parse source file → 2. Find targets → 3. Analyze deps
 *   4. Create new files → 5. Update source → 6. Rewrite imports
 */

import { Project, SourceFile, SyntaxKind, FunctionDeclaration, VariableStatement } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getProject, getSourceFile } from './parser';
import { analyzeFunctions } from './analyzer';
import { analyzeDependencies } from './dependency-analyzer';
import { rewriteImportsAcrossProject } from './import-rewriter';
import { toFileName } from './naming';
import type {
  ExtractOptions, ExtractResult, FunctionInfo,
  DependencyReport, DistillConfig, RequiredImport,
} from '../types';
import * as logger from '../utils/logger';

/**
 * Extract functions from a source file into their own modules.
 * Main entry point for the extraction pipeline.
 */
export async function extract(
  options: ExtractOptions,
  config: DistillConfig
): Promise<ExtractResult> {
  const { filePath, functions: functionNames, match, minLines, outDir, naming, dryRun = false, validate = true } = options;
  const absoluteFilePath = path.resolve(filePath);
  const result: ExtractResult = { created: [], modified: [], warnings: [], dryRun };

  const project = getProject(config.tsconfig);
  const sourceFile = getSourceFile(project, absoluteFilePath);
  const allFunctions = analyzeFunctions(sourceFile);
  const targets = selectTargets(allFunctions, functionNames, match, minLines);

  if (targets.length === 0) {
    result.warnings.push('No matching functions found to extract.');
    return result;
  }

  logger.info(`Found ${targets.length} function(s) to extract: ${targets.map(t => t.name).join(', ')}`);

  const sourceDir = path.dirname(absoluteFilePath);
  const outputDir = outDir ? path.resolve(outDir) : path.resolve(sourceDir, config.defaultOutDir);
  if (!dryRun && !fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const namingConvention = naming || config.naming;
  const originalSourceContent = sourceFile.getFullText();

  // Pre-compute extraction plans before mutating the AST
  const extractionPlans = [];
  const depUsage = new Map<string, string[]>();

  for (const target of targets) {
    const deps = analyzeDependencies(sourceFile, target.name);
    
    for (const dep of deps.inFileDeps) {
      if (!depUsage.has(dep.name)) depUsage.set(dep.name, []);
      depUsage.get(dep.name)!.push(target.name);
    }
    
    const ext = path.extname(absoluteFilePath);
    const newFileName = toFileName(target.name, namingConvention) + ext;
    const newFilePath = path.join(outputDir, newFileName);
    const newFileContent = buildNewFileContent(sourceFile, target, deps, absoluteFilePath, newFilePath);
    extractionPlans.push({ target, newFilePath, newFileContent });
  }

  // Detect and warn about duplicated dependencies
  for (const [depName, users] of depUsage.entries()) {
    if (users.length > 1) {
      const msg = `Shared dependency "${depName}" is duplicated across extracted files: ${users.join(', ')}`;
      result.warnings.push(msg);
      logger.warn(msg);
    }
  }

  // Apply mutations
  for (const plan of extractionPlans) {
    const { target, newFilePath, newFileContent } = plan;
    logger.debug(`Extracting "${target.name}"...`);

    result.created.push({ path: newFilePath, functionName: target.name, content: newFileContent });
    removeFunctionFromSource(sourceFile, target.name);
    addImportToSource(sourceFile, target.name, newFilePath, absoluteFilePath);

    if (config.preserveBarrelExports) {
      addBarrelReExport(sourceFile, target.name, newFilePath, absoluteFilePath);
    }
  }

  const newSourceContent = sourceFile.getFullText();
  if (newSourceContent !== originalSourceContent) {
    result.modified.push({ path: absoluteFilePath, originalContent: originalSourceContent, newContent: newSourceContent });
  }

  const importRewrites = rewriteImportsAcrossProject(
    project, absoluteFilePath,
    targets.map(t => ({
      functionName: t.name,
      newFilePath: path.join(outputDir, toFileName(t.name, namingConvention) + path.extname(absoluteFilePath)),
      isDefaultExport: t.isDefaultExport,
    })),
    config.exclude
  );
  result.modified.push(...importRewrites);

  if (!dryRun) {
    for (const created of result.created) {
      const dir = path.dirname(created.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(created.path, created.content, 'utf-8');
      logger.success(`Created ${logger.formatPath(path.relative(process.cwd(), created.path))}`);
    }
    for (const modified of result.modified) {
      fs.writeFileSync(modified.path, modified.newContent, 'utf-8');
      logger.success(`Updated ${logger.formatPath(path.relative(process.cwd(), modified.path))}`);
    }

    if (validate) {
      logger.info('Validating with TypeScript...');
      try {
        const cmd = `npx tsc --noEmit --project ${config.tsconfig}`;
        execSync(cmd, { stdio: 'ignore' });
        logger.success('Validation passed.');
      } catch (err) {
        logger.error('TypeScript validation failed! Rolling back changes...');
        for (const created of result.created) {
          if (fs.existsSync(created.path)) fs.unlinkSync(created.path);
        }
        for (const modified of result.modified) {
          fs.writeFileSync(modified.path, modified.originalContent, 'utf-8');
        }
        throw new Error('Extraction resulted in TypeScript errors. Rolled back.');
      }
    }

    // Save manifest for undo/cleanup
    try {
      const manifestDir = path.join(process.cwd(), '.distill');
      if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
      
      const manifestPath = path.join(manifestDir, `extract-${Date.now()}.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2), 'utf-8');
      logger.debug(`Manifest saved to ${manifestPath}`);
    } catch (e) {
      logger.debug('Failed to save manifest: ' + String(e));
    }
  }

  return result;
}

/** Filter functions to the ones the user wants to extract. */
function selectTargets(all: FunctionInfo[], names?: string[], match?: string, minLines?: number): FunctionInfo[] {
  let targets = all;
  if (names && names.length > 0) {
    targets = targets.filter(f => names.includes(f.name));
    for (const n of names) {
      if (!targets.find(t => t.name === n)) logger.warn(`Function "${n}" not found`);
    }
  }
  if (match) { const re = new RegExp(match); targets = targets.filter(f => re.test(f.name)); }
  if (minLines !== undefined) targets = targets.filter(f => f.lineCount >= minLines);
  return targets;
}

/** Build the content for a new extracted file. */
function buildNewFileContent(
  sourceFile: SourceFile, target: FunctionInfo,
  deps: DependencyReport, originalFilePath: string, newFilePath: string
): string {
  const lines: string[] = [];

  for (const imp of deps.requiredImports) {
    lines.push(buildImportStatement(imp, originalFilePath, newFilePath));
  }
  if (deps.requiredImports.length > 0) lines.push('');

  for (const dep of deps.inFileDeps) {
    let text = dep.declarationText;
    if (!text.startsWith('export ') && !text.startsWith('export\n')) {
      text = 'export ' + text;
    }
    lines.push(text);
    lines.push('');
  }

  const funcNode = findNode(sourceFile, target.name);
  if (funcNode) {
    let funcText = funcNode.getFullText().trim();
    if (!target.isExported) funcText = 'export ' + funcText;
    lines.push(funcText);
    lines.push('');
  }

  return lines.join('\n');
}

/** Build a single import statement, adjusting relative paths for the new file location. */
function buildImportStatement(imp: RequiredImport, originalFilePath: string, newFilePath: string): string {
  let spec = imp.moduleSpecifier;
  if (spec.startsWith('.')) {
    const absTarget = path.resolve(path.dirname(originalFilePath), spec);
    let rel = path.relative(path.dirname(newFilePath), absTarget);
    if (!rel.startsWith('.')) rel = './' + rel;
    spec = rel.replace(/\\/g, '/');
  }
  const tp = imp.isTypeOnly ? 'type ' : '';
  const parts: string[] = [];
  if (imp.defaultImport) parts.push(imp.defaultImport);
  if (imp.namespaceImport) parts.push(`* as ${imp.namespaceImport}`);
  if (imp.namedImports.length > 0) parts.push(`{ ${imp.namedImports.join(', ')} }`);
  return `import ${tp}${parts.join(', ')} from '${spec}';`;
}

/** Find function node by name. */
function findNode(sf: SourceFile, name: string): FunctionDeclaration | VariableStatement | undefined {
  const f = sf.getFunction(name);
  if (f) return f;
  for (const vs of sf.getVariableStatements()) {
    for (const d of vs.getDeclarations()) { if (d.getName() === name) return vs; }
  }
  return undefined;
}

/** Remove a function from the source file AST. */
function removeFunctionFromSource(sf: SourceFile, name: string): void {
  const f = sf.getFunction(name);
  if (f) { f.remove(); return; }
  for (const vs of sf.getVariableStatements()) {
    for (const d of vs.getDeclarations()) {
      if (d.getName() === name) {
        if (vs.getDeclarations().length === 1) vs.remove(); else d.remove();
        return;
      }
    }
  }
}

/** Add an import for the extracted function to the source file. */
function addImportToSource(sf: SourceFile, name: string, newPath: string, srcPath: string): void {
  let rel = path.relative(path.dirname(srcPath), newPath).replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  sf.addImportDeclaration({ moduleSpecifier: rel, namedImports: [name] });
}

/** Add a re-export for backward compatibility. */
function addBarrelReExport(sf: SourceFile, name: string, newPath: string, srcPath: string): void {
  let rel = path.relative(path.dirname(srcPath), newPath).replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  for (const e of sf.getExportDeclarations()) { if (e.getModuleSpecifierValue() === rel) return; }
  sf.addExportDeclaration({ moduleSpecifier: rel, namedExports: [name] });
}
