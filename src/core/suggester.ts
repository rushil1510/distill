/**
 * Distill - Refactor suggester
 *
 * This is the engine behind `distill suggest`. It answers the question the
 * `extract` command can't: "what should I split in the first place?"
 *
 * For each file it:
 *   1. Builds the intra-file symbol graph (symbol-graph.ts).
 *   2. Clusters symbols into independent responsibility groups (clusterer.ts).
 *   3. Measures coupling via real ts-morph module resolution (fan-in/fan-out).
 *   4. Scores the file so the worst god-files rank first.
 *
 * The deliberate bet (see CLAUDE.md): the rest of the market races to give an
 * AI a better *map* of the code. This gives it the judgement to decide where
 * the code should be *cut* — then hands that straight to the safe `extract`
 * pipeline.
 */

import { Project, SourceFile } from 'ts-morph';
import * as path from 'path';
import micromatch from 'micromatch';
import { buildSymbolGraph } from './symbol-graph';
import { clusterSymbols } from './clusterer';
import type { FileSuggestion, NamingConvention } from '../types';

/** Inputs needed to score a single file. */
export interface SuggestContext {
  naming: NamingConvention;
  /** Pre-computed fan-in (how many other files import this one). */
  fanIn: number;
}

/**
 * Analyze one file and produce a refactor suggestion: its clusters, coupling,
 * and god-file score.
 */
export function suggestForFile(
  sourceFile: SourceFile,
  ctx: SuggestContext
): FileSuggestion {
  const graph = buildSymbolGraph(sourceFile);
  const clusters = clusterSymbols(graph, ctx.naming);

  const lineCount = sourceFile.getEndLineNumber();
  const symbolCount = graph.symbols.size;
  const fanOut = countFanOut(sourceFile);
  const score = computeScore(lineCount, clusters.length, ctx.fanIn, fanOut);

  return {
    filePath: sourceFile.getFilePath(),
    lineCount,
    symbolCount,
    clusters,
    clusterCount: clusters.length,
    fanIn: ctx.fanIn,
    fanOut,
    score,
  };
}

/**
 * Scan a whole project and return per-file suggestions ranked worst-first.
 *
 * @param project - A ts-morph Project (already loaded from tsconfig).
 * @param opts    - Naming convention and glob excludes.
 */
export function suggestForProject(
  project: Project,
  opts: { naming: NamingConvention; exclude: string[] }
): FileSuggestion[] {
  const files = projectSourceFiles(project, opts.exclude);
  const fanIn = computeFanIn(project, files);

  const suggestions = files.map((sf) =>
    suggestForFile(sf, { naming: opts.naming, fanIn: fanIn.get(sf.getFilePath()) ?? 0 })
  );

  suggestions.sort((a, b) => b.score - a.score || b.lineCount - a.lineCount);
  return suggestions;
}

/**
 * God-file score. Higher = worse offender / better split candidate.
 *
 * The dominant signal is "large AND fragmented": a big file made of several
 * independent clusters can be cleanly cut apart, while a big-but-cohesive file
 * (one cluster) scores zero — splitting it would just scatter tightly coupled
 * code. Coupling (fan-in + fan-out) is added as a smaller term so that, among
 * similar split candidates, the more entangled file is surfaced first.
 *
 *   score = lineCount × (clusterCount − 1) + (fanIn + fanOut)
 */
export function computeScore(
  lineCount: number,
  clusterCount: number,
  fanIn: number,
  fanOut: number
): number {
  const splitPotential = lineCount * Math.max(0, clusterCount - 1);
  return Math.round(splitPotential + fanIn + fanOut);
}

/** Count distinct modules this file imports from (fan-out). */
function countFanOut(sourceFile: SourceFile): number {
  const specifiers = new Set<string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    specifiers.add(imp.getModuleSpecifierValue());
  }
  return specifiers.size;
}

/**
 * Compute fan-in for every file: how many *other* in-scope files import it.
 *
 * Resolution uses TypeScript's real module resolution
 * (getModuleSpecifierSourceFile) — the same mechanism the import-rewriter
 * trusts — rather than string matching on specifiers.
 */
function computeFanIn(
  project: Project,
  files: SourceFile[]
): Map<string, number> {
  const inScope = new Set(files.map((f) => f.getFilePath()));
  const counts = new Map<string, number>();
  for (const p of inScope) counts.set(p, 0);

  // Importers can be any file in the project, even ones excluded from
  // scoring — they still represent real consumers of a target file.
  for (const importer of project.getSourceFiles()) {
    const seen = new Set<string>();
    for (const imp of importer.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetPath = target.getFilePath();
      if (targetPath === importer.getFilePath()) continue; // ignore self
      if (!inScope.has(targetPath)) continue;
      if (seen.has(targetPath)) continue; // count each importer once per target
      seen.add(targetPath);
      counts.set(targetPath, (counts.get(targetPath) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Select the real, authored source files in a project: excludes declaration
 * files, node_modules, and anything matching the configured exclude globs.
 */
export function projectSourceFiles(
  project: Project,
  exclude: string[]
): SourceFile[] {
  return project.getSourceFiles().filter((sf) => {
    const filePath = sf.getFilePath();
    if (sf.isDeclarationFile()) return false;
    if (filePath.includes('/node_modules/')) return false;
    const rel = path.relative(process.cwd(), filePath);
    if (exclude.length && micromatch.isMatch(rel, exclude)) return false;
    if (exclude.length && micromatch.isMatch(filePath, exclude)) return false;
    return true;
  });
}

/**
 * Fan-in for a single target file, when not doing a full project scan.
 */
export function fanInForFile(project: Project, targetPath: string): number {
  let count = 0;
  for (const importer of project.getSourceFiles()) {
    if (importer.getFilePath() === targetPath) continue;
    let importsTarget = false;
    for (const imp of importer.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (target && target.getFilePath() === targetPath) {
        importsTarget = true;
        break;
      }
    }
    if (importsTarget) count++;
  }
  return count;
}
