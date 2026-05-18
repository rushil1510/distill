/**
 * Distill - Logger utility
 *
 * Colorized, leveled console output for the CLI.
 * Uses chalk v4 (CommonJS compatible) for terminal colors.
 */

import chalk from 'chalk';

/** Whether verbose logging is enabled. Set via CLI --verbose flag. */
let verbose = false;

/** Enable or disable verbose logging. */
export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

/** Log an informational message (always shown). */
export function info(msg: string): void {
  console.log(chalk.cyan('ℹ') + ' ' + msg);
}

/** Log a success message. */
export function success(msg: string): void {
  console.log(chalk.green('✔') + ' ' + msg);
}

/** Log a warning (non-fatal). */
export function warn(msg: string): void {
  console.log(chalk.yellow('⚠') + ' ' + chalk.yellow(msg));
}

/** Log an error. */
export function error(msg: string): void {
  console.error(chalk.red('✖') + ' ' + chalk.red(msg));
}

/** Log a debug message (only shown with --verbose). */
export function debug(msg: string): void {
  if (verbose) {
    console.log(chalk.gray('  › ' + msg));
  }
}

/**
 * Log a section header - used to visually separate phases
 * of the extraction pipeline in CLI output.
 */
export function section(title: string): void {
  console.log('');
  console.log(chalk.bold.underline(title));
}

/**
 * Format a file path for display, highlighting the basename.
 * Example: "src/utils/" + "calculateTax.ts"
 */
export function formatPath(filePath: string): string {
  const parts = filePath.split('/');
  const basename = parts.pop() || '';
  const dir = parts.join('/');
  return chalk.gray(dir ? dir + '/' : '') + chalk.white.bold(basename);
}
