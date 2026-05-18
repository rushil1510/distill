/**
 * Distill - CLI entry point
 *
 * Defines the CLI commands and options using Commander.
 *
 * Commands:
 *   distill analyze <file>                 - List extractable functions
 *   distill extract <file> --function <n>  - Extract function(s) to new file(s)
 */

import { Command } from 'commander';
import { runAnalyze } from './commands/analyze';
import { runExtract } from './commands/extract';
import { setVerbose } from './utils/logger';

const pkg = require('../package.json');

const program = new Command();

program
  .name('distill')
  .description(
    'Extract functions from large files into clean, single-responsibility modules.\n' +
    'Automatically rewires imports across your entire codebase.'
  )
  .version(pkg.version || '0.1.0');

// ── analyze command ─────────────────────────────────────────────────
program
  .command('analyze <file>')
  .description('List all extractable functions in a file')
  .option('--min-lines <n>', 'Only show functions with at least N lines', parseInt)
  .option('--match <pattern>', 'Filter function names by regex pattern')
  .option('--json', 'Output results as JSON')
  .action((file: string, opts: any) => {
    runAnalyze(file, opts);
  });

// ── extract command ─────────────────────────────────────────────────
program
  .command('extract <file>')
  .description('Extract function(s) from a file into separate modules')
  .option('-f, --function <names...>', 'Function name(s) to extract')
  .option('--match <pattern>', 'Extract functions matching a regex pattern')
  .option('--min-lines <n>', 'Extract functions with at least N lines', parseInt)
  .option('-o, --outdir <dir>', 'Output directory for extracted files')
  .option('--naming <convention>', 'File naming: camelCase, kebab-case, PascalCase', 'camelCase')
  .option('-d, --dry-run', 'Preview changes without writing to disk')
  .option('--no-validate', 'Skip post-extraction TypeScript validation')
  .option('--json', 'Output results as JSON')
  .option('-v, --verbose', 'Show debug output')
  .action(async (file: string, opts: any) => {
    if (opts.verbose) setVerbose(true);
    await runExtract(file, opts);
  });

export { program };
