/**
 * Distill - Analyze command
 *
 * Scans a source file and prints a table of all extractable functions
 * with their metadata (name, kind, line count, exported status).
 *
 * Usage: distill analyze <file>
 */

import * as path from 'path';
import chalk from 'chalk';
import { getProject, getSourceFile } from '../core/parser';
import { analyzeFunctions } from '../core/analyzer';
import { loadConfig } from '../utils/config';
import * as logger from '../utils/logger';
import type { FunctionInfo } from '../types';

/**
 * Run the analyze command.
 *
 * @param filePath - Path to the file to analyze.
 * @param opts     - CLI options (minLines, match).
 */
export function runAnalyze(
  filePath: string,
  opts: { minLines?: number; match?: string }
): void {
  const config = loadConfig();
  const absolutePath = path.resolve(filePath);

  const project = getProject(config.tsconfig);
  const sourceFile = getSourceFile(project, absolutePath);
  let functions = analyzeFunctions(sourceFile);

  // Apply filters
  if (opts.match) {
    const re = new RegExp(opts.match);
    functions = functions.filter(f => re.test(f.name));
  }
  if (opts.minLines !== undefined) {
    functions = functions.filter(f => f.lineCount >= opts.minLines!);
  }

  if ((opts as any).json) {
    console.log(JSON.stringify(functions, null, 2));
    return;
  }

  if (functions.length === 0) {
    logger.info('No extractable functions found.');
    return;
  }

  // Print results as a formatted table
  logger.section(`Functions in ${logger.formatPath(path.relative(process.cwd(), absolutePath))}`);
  console.log('');

  // Table header
  const header = [
    pad('Name', 30),
    pad('Kind', 20),
    pad('Lines', 8),
    pad('Exported', 10),
    pad('Location', 15),
  ].join('  ');

  console.log(chalk.gray(header));
  console.log(chalk.gray('─'.repeat(90)));

  // Table rows
  for (const f of functions) {
    const kindBadge = getKindBadge(f.kind);
    const exportBadge = f.isExported
      ? chalk.green('✔ exported')
      : chalk.gray('internal');

    const row = [
      pad(chalk.bold(f.name), 30),
      pad(kindBadge, 20),
      pad(String(f.lineCount), 8),
      pad(exportBadge, 10),
      pad(chalk.gray(`L${f.startLine}-${f.endLine}`), 15),
    ].join('  ');

    console.log(row);
  }

  console.log('');
  logger.info(
    `${functions.length} function(s) found. ` +
    `Total: ${functions.reduce((sum, f) => sum + f.lineCount, 0)} lines.`
  );
}

/** Right-pad a string to a given width. */
function pad(str: string, width: number): string {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);
  return str + ' '.repeat(padding);
}

/** Get a colored badge for the function kind. */
function getKindBadge(kind: FunctionInfo['kind']): string {
  switch (kind) {
    case 'function':
      return chalk.blue('ƒ function');
    case 'arrow':
      return chalk.magenta('⇒ arrow');
    case 'function-expression':
      return chalk.yellow('ƒ expression');
    default:
      return kind;
  }
}
