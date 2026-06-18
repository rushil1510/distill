/**
 * Distill - Suggest command
 *
 * Answers "what's the worst file, and how should I split it?"
 *
 *   distill suggest                 → scan the project, rank god-files
 *   distill suggest src/utils.ts    → propose a split for one file
 *
 * The output of each ranked file is a concrete extraction plan: which symbols
 * form each independent cluster and what to name the resulting module. An
 * accepted suggestion feeds straight into `distill extract`.
 */

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { getProject, getSourceFile } from '../core/parser';
import {
  suggestForFile,
  suggestForProject,
  fanInForFile,
} from '../core/suggester';
import { loadConfig } from '../utils/config';
import * as logger from '../utils/logger';
import type { FileSuggestion, NamingConvention } from '../types';

interface SuggestOptions {
  json?: boolean;
  top?: number;
  minLines?: number;
  minClusters?: number;
  naming?: NamingConvention;
}

/**
 * Run the suggest command.
 *
 * @param target - Optional file or directory. Omitted → whole project.
 * @param opts   - CLI options.
 */
export function runSuggest(target: string | undefined, opts: SuggestOptions): void {
  const config = loadConfig(opts.naming ? { naming: opts.naming } : {});
  const project = getProject(config.tsconfig);
  const naming = config.naming;

  const isFile =
    target !== undefined &&
    fs.existsSync(path.resolve(target)) &&
    fs.statSync(path.resolve(target)).isFile();

  let suggestions: FileSuggestion[];

  if (isFile) {
    const absolutePath = path.resolve(target!);
    const sourceFile = getSourceFile(project, absolutePath);
    const fanIn = fanInForFile(project, absolutePath);
    suggestions = [suggestForFile(sourceFile, { naming, fanIn })];
  } else {
    suggestions = suggestForProject(project, { naming, exclude: config.exclude });
  }

  // Apply filters (skip in single-file mode so an explicit request always
  // shows something).
  if (!isFile) {
    if (opts.minLines !== undefined) {
      suggestions = suggestions.filter((s) => s.lineCount >= opts.minLines!);
    }
    const minClusters = opts.minClusters ?? 2;
    suggestions = suggestions.filter((s) => s.clusterCount >= minClusters);
    if (opts.top !== undefined) {
      suggestions = suggestions.slice(0, opts.top);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(suggestions, null, 2));
    return;
  }

  printHuman(suggestions, isFile);
}

/** Render suggestions as a human-readable report. */
function printHuman(suggestions: FileSuggestion[], isFile: boolean): void {
  if (suggestions.length === 0) {
    logger.info(
      isFile
        ? 'This file looks cohesive — no independent clusters to split out.'
        : 'No god-files found. Every scanned file is cohesive or small.'
    );
    return;
  }

  if (!isFile) {
    logger.section(`Top split candidates (${suggestions.length})`);
    console.log('');
  }

  suggestions.forEach((s, idx) => {
    const rel = path.relative(process.cwd(), s.filePath);
    const rank = isFile ? '' : chalk.gray(`#${idx + 1}  `);
    console.log(
      `${rank}${logger.formatPath(rel)}  ` +
        chalk.gray(
          `(${s.lineCount} lines · ${s.symbolCount} symbols · ` +
            `${s.clusterCount} clusters · fan-in ${s.fanIn} · fan-out ${s.fanOut})`
        ) +
        '  ' +
        scoreBadge(s.score)
    );

    if (s.clusterCount < 2) {
      console.log(
        '   ' + chalk.gray('Single cohesive cluster — nothing to split out.')
      );
      console.log('');
      return;
    }

    // Show each cluster as a proposed module.
    s.clusters.forEach((c, ci) => {
      const apiTag = c.hasExportedSymbol ? chalk.green(' [public]') : '';
      console.log(
        '   ' +
          chalk.cyan(`${ci + 1}.`) +
          ` ${chalk.bold(c.suggestedName)}` +
          chalk.gray(`  (${c.lineCount} lines)`) +
          apiTag
      );
      console.log('      ' + chalk.gray(c.symbols.join(', ')));
    });

    // Hint how to act on the largest cluster via the existing extract pipeline.
    const fnSymbols = s.clusters[0].symbols;
    const relForCmd = rel;
    console.log(
      '   ' +
        chalk.gray('→ ') +
        chalk.white(
          `distill extract ${relForCmd} --function ${fnSymbols.slice(0, 4).join(' ')}` +
            (fnSymbols.length > 4 ? ' …' : '')
        )
    );
    console.log('');
  });

  if (!isFile) {
    logger.info(
      `Score = lines × (clusters − 1) + coupling. ` +
        `Higher = more worth splitting.`
    );
  }
}

/** Color a score by severity for quick scanning. */
function scoreBadge(score: number): string {
  const label = `score ${score}`;
  if (score >= 2000) return chalk.red.bold(label);
  if (score >= 500) return chalk.yellow.bold(label);
  return chalk.gray(label);
}
