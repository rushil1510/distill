/**
 * Distill - Extract command
 *
 * Extracts one or more functions from a source file into separate
 * modules, rewrites imports, and displays a summary of changes.
 *
 * Usage:
 *   distill extract <file> --function <name>
 *   distill extract <file> --match "^calculate"
 *   distill extract <file> --min-lines 20
 */

import * as path from 'path';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import { extract } from '../core/extractor';
import { loadConfig } from '../utils/config';
import * as logger from '../utils/logger';
import type { NamingConvention } from '../types';

/** CLI options for the extract command. */
interface ExtractCommandOpts {
  function?: string[];
  match?: string;
  minLines?: number;
  outdir?: string;
  naming?: NamingConvention;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
  validate?: boolean;
}

/**
 * Run the extract command.
 */
export async function runExtract(filePath: string, opts: ExtractCommandOpts): Promise<void> {
  const config = loadConfig({
    ...(opts.naming ? { naming: opts.naming } : {}),
  });

  try {
    const result = await extract(
      {
        filePath,
        functions: opts.function,
        match: opts.match,
        minLines: opts.minLines,
        outDir: opts.outdir,
        naming: opts.naming,
        dryRun: opts.dryRun,
        validate: opts.validate,
      },
      config
    );

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Handle warnings
    for (const w of result.warnings) {
      logger.warn(w);
    }

    if (result.created.length === 0) {
      return;
    }

    // Print summary
    logger.section('Extraction Summary');
    console.log('');

    if (result.dryRun) {
      console.log(chalk.yellow.bold('  DRY RUN - no files were written\n'));
    }

    // Show created files
    console.log(chalk.bold('  Created:'));
    for (const c of result.created) {
      const rel = path.relative(process.cwd(), c.path);
      console.log(`    ${chalk.green('+')} ${logger.formatPath(rel)} ${chalk.gray(`(${c.functionName})`)}`);
    }
    console.log('');

    // Show modified files
    if (result.modified.length > 0) {
      console.log(chalk.bold('  Modified:'));
      for (const m of result.modified) {
        const rel = path.relative(process.cwd(), m.path);
        console.log(`    ${chalk.blue('~')} ${logger.formatPath(rel)}`);
      }
      console.log('');
    }

    // In dry-run mode, show diffs
    if (result.dryRun) {
      logger.section('Diffs (preview)');

      for (const c of result.created) {
        const rel = path.relative(process.cwd(), c.path);
        console.log('');
        console.log(chalk.bold.green(`  +++ ${rel} (new file)`));
        const lines = c.content.split('\n');
        for (const line of lines) {
          console.log(chalk.green(`  + ${line}`));
        }
      }

      for (const m of result.modified) {
        const rel = path.relative(process.cwd(), m.path);
        console.log('');
        const patch = createTwoFilesPatch(
          rel, rel,
          m.originalContent, m.newContent,
          'original', 'modified'
        );
        // Colorize the diff output
        for (const line of patch.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            console.log(chalk.green('  ' + line));
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            console.log(chalk.red('  ' + line));
          } else if (line.startsWith('@@')) {
            console.log(chalk.cyan('  ' + line));
          } else {
            console.log(chalk.gray('  ' + line));
          }
        }
      }
      console.log('');
    }

    // Final count
    logger.success(
      `${result.dryRun ? 'Would extract' : 'Extracted'} ${result.created.length} function(s), ` +
      `modified ${result.modified.length} file(s).`
    );

  } catch (err: any) {
    logger.error(err.message || String(err));
    process.exit(1);
  }
}
