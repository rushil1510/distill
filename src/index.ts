/**
 * Distill - Programmatic API
 *
 * This is the public API for using Distill as a library.
 * Import this in your scripts or agent integrations:
 *
 *   const { distill } = require('distill');
 *   // or
 *   import { distill } from 'distill';
 *
 * @example
 * ```ts
 * const result = await distill.extract({
 *   filePath: 'src/utils.ts',
 *   functions: ['calculateTax'],
 *   outDir: 'src/utils/',
 *   dryRun: true,
 * });
 * console.log(result.created); // New files that would be created
 * ```
 */

import { extract } from './core/extractor';
import { analyzeFunctions } from './core/analyzer';
import { analyzeDependencies } from './core/dependency-analyzer';
import { getProject, getSourceFile, clearCache } from './core/parser';
import { loadConfig } from './utils/config';
import { toFileName } from './core/naming';
import * as path from 'path';
import type {
  ExtractOptions,
  ExtractResult,
  FunctionInfo,
  DependencyReport,
  DistillConfig,
} from './types';

/**
 * The public Distill API object.
 */
export const distill = {
  /**
   * Extract functions from a file into separate modules.
   * This is the main API method.
   */
  async extract(
    options: ExtractOptions,
    configOverrides?: Partial<DistillConfig>
  ): Promise<ExtractResult> {
    const config = loadConfig(configOverrides);
    return extract(options, config);
  },

  /**
   * Analyze a file and return info about all extractable functions.
   * Does not modify any files.
   */
  analyze(filePath: string, tsconfigPath?: string): FunctionInfo[] {
    const config = loadConfig(tsconfigPath ? { tsconfig: tsconfigPath } : {});
    const project = getProject(config.tsconfig);
    const sourceFile = getSourceFile(project, path.resolve(filePath));
    return analyzeFunctions(sourceFile);
  },

  /**
   * Analyze the dependencies of a specific function.
   * Useful for understanding what would be co-extracted.
   */
  analyzeDeps(filePath: string, functionName: string, tsconfigPath?: string): DependencyReport {
    const config = loadConfig(tsconfigPath ? { tsconfig: tsconfigPath } : {});
    const project = getProject(config.tsconfig);
    const sourceFile = getSourceFile(project, path.resolve(filePath));
    return analyzeDependencies(sourceFile, functionName);
  },

  /** Clear the internal project cache. */
  clearCache,
};

// Re-export types for consumers
export type {
  ExtractOptions,
  ExtractResult,
  FunctionInfo,
  DependencyReport,
  DistillConfig,
};
