/**
 * Distill - Configuration loader
 *
 * Loads configuration from (in priority order):
 *   1. CLI flags (highest priority)
 *   2. .distillrc.json / distill.config.js / distill.config.ts
 *   3. "distill" key in package.json
 *   4. Built-in defaults (lowest priority)
 *
 * Uses cosmiconfig for automatic config file discovery.
 */

import { cosmiconfigSync } from 'cosmiconfig';
import type { DistillConfig } from '../types';

/** Sensible defaults for all configuration options. */
export const DEFAULT_CONFIG: DistillConfig = {
  naming: 'camelCase',
  defaultOutDir: './',
  preserveBarrelExports: true,
  tsconfig: './tsconfig.json',
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.spec.ts'],
};

/**
 * Load and merge configuration from all sources.
 *
 * @param overrides - Partial config from CLI flags, merged last (highest priority).
 * @returns Fully resolved DistillConfig.
 */
export function loadConfig(overrides: Partial<DistillConfig> = {}): DistillConfig {
  const explorer = cosmiconfigSync('distill');
  const result = explorer.search();

  const fileConfig: Partial<DistillConfig> = result?.config || {};

  // Merge: defaults < file config < CLI overrides
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...overrides,
  };
}
