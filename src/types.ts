/**
 * Distill - Shared type definitions
 *
 * All core types used across the extraction pipeline are defined here.
 * This keeps the codebase consistent and makes it easy for consumers
 * of the programmatic API to import what they need.
 */

// ─── Naming Conventions ─────────────────────────────────────────────

/** Supported file naming conventions for extracted function files. */
export type NamingConvention = 'camelCase' | 'kebab-case' | 'PascalCase';

// ─── Configuration ──────────────────────────────────────────────────

/** Configuration loaded from .distillrc.json or CLI flags. */
export interface DistillConfig {
  /** File naming convention for extracted modules. Default: 'camelCase' */
  naming: NamingConvention;

  /** Default output directory (relative to source file). Default: './' */
  defaultOutDir: string;

  /**
   * If true, a barrel re-export is added to the original file so that
   * existing consumers don't break even before imports are rewritten.
   * Default: true
   */
  preserveBarrelExports: boolean;

  /** Path to tsconfig.json. Default: './tsconfig.json' */
  tsconfig: string;

  /** Glob patterns to exclude from import scanning. */
  exclude: string[];
}

// ─── Extraction Options ─────────────────────────────────────────────

/** Options passed to the extract command / programmatic API. */
export interface ExtractOptions {
  /** Absolute path to the source file containing the function. */
  filePath: string;

  /** Exact function name(s) to extract. Mutually exclusive with `match`. */
  functions?: string[];

  /** Regex pattern to match function names. Mutually exclusive with `functions`. */
  match?: string;

  /** Only extract functions with at least this many lines. */
  minLines?: number;

  /** Output directory for extracted files. Defaults to config.defaultOutDir. */
  outDir?: string;

  /** File naming convention override. */
  naming?: NamingConvention;

  /** If true, print changes without writing to disk. */
  dryRun?: boolean;

  /** If false, skips post-extraction tsc validation. Default: true. */
  validate?: boolean;
}

// ─── Analysis Results ───────────────────────────────────────────────

/** Describes a single function found during analysis. */
export interface FunctionInfo {
  /** The function's identifier name. */
  name: string;

  /** The kind of declaration (function statement, arrow const, etc.). */
  kind: 'function' | 'arrow' | 'function-expression';

  /** Whether it's already exported. */
  isExported: boolean;

  /** Whether it's a default export. */
  isDefaultExport: boolean;

  /** Starting line number (1-indexed). */
  startLine: number;

  /** Ending line number (1-indexed). */
  endLine: number;

  /** Total line count of the function body. */
  lineCount: number;

  /** JSDoc comment text, if present. */
  jsdoc?: string;
}

// ─── Dependency Analysis ────────────────────────────────────────────

/** A dependency that a function has on something defined in the same file. */
export interface InFileDependency {
  /** The identifier name being referenced. */
  name: string;

  /** What kind of thing it is. */
  kind: 'function' | 'variable' | 'type' | 'interface' | 'enum' | 'class';

  /** The full source text of the declaration (for co-extraction). */
  declarationText: string;

  /** Starting line of the declaration. */
  startLine: number;

  /** Ending line of the declaration. */
  endLine: number;
}

/** An import statement that the extracted function needs. */
export interface RequiredImport {
  /** The module specifier (e.g., 'lodash', '../helpers'). */
  moduleSpecifier: string;

  /** Named imports used (e.g., ['map', 'filter']). */
  namedImports: string[];

  /** Default import name, if used. */
  defaultImport?: string;

  /** Namespace import name (e.g., `import * as foo`), if used. */
  namespaceImport?: string;

  /** Whether this is a type-only import. */
  isTypeOnly: boolean;
}

/** Full dependency report for a function. */
export interface DependencyReport {
  /** Identifiers defined in the same file that this function uses. */
  inFileDeps: InFileDependency[];

  /** External/third-party imports that this function needs. */
  requiredImports: RequiredImport[];
}

// ─── Symbol Graph & Clustering ──────────────────────────────────────

/** The kind of a top-level symbol declared in a file. */
export type SymbolKind =
  | 'function'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'class';

/** A single top-level symbol declared in a file. */
export interface FileSymbol {
  /** The symbol's identifier name. */
  name: string;

  /** What kind of declaration it is. */
  kind: SymbolKind;

  /** Whether it's exported from the file. */
  isExported: boolean;

  /** Starting line of the declaration (1-indexed). */
  startLine: number;

  /** Ending line of the declaration (1-indexed). */
  endLine: number;

  /** Total line count of the declaration. */
  lineCount: number;
}

/**
 * An intra-file symbol dependency graph: which top-level symbols
 * reference which other top-level symbols in the same file.
 */
export interface SymbolGraph {
  /** All top-level symbols, keyed by name. */
  symbols: Map<string, FileSymbol>;

  /**
   * Adjacency map: symbol name → set of other in-file symbol names it
   * references. Edges are stored as directed (referencer → referenced)
   * but clustering treats them as undirected.
   */
  edges: Map<string, Set<string>>;
}

/**
 * A connected component of the symbol graph — a group of symbols that
 * reference each other (directly or transitively) but are independent
 * of symbols in other clusters. Each cluster is a candidate module.
 */
export interface SymbolCluster {
  /** Symbol names belonging to this cluster. */
  symbols: string[];

  /** Total lines spanned by this cluster's declarations. */
  lineCount: number;

  /** Whether any symbol in the cluster is exported (part of the file's API). */
  hasExportedSymbol: boolean;

  /**
   * Suggested module file name (stem only, no extension), derived from the
   * cluster's most prominent symbol via the configured naming convention.
   */
  suggestedName: string;
}

/**
 * A ranked refactor suggestion for a single file: how bad a god-file it is
 * and how it could be split into independent modules.
 */
export interface FileSuggestion {
  /** Absolute path to the file. */
  filePath: string;

  /** Total line count of the file. */
  lineCount: number;

  /** Number of top-level symbols in the file. */
  symbolCount: number;

  /** Independent clusters (candidate modules) found in the file. */
  clusters: SymbolCluster[];

  /** Number of independent clusters (candidate modules). */
  clusterCount: number;

  /** How many other files in the project import from this file. */
  fanIn: number;

  /** How many distinct modules this file imports from. */
  fanOut: number;

  /**
   * Heuristic priority score (higher = worse god-file / better split
   * candidate). Driven by line count and independent-cluster count.
   */
  score: number;
}

// ─── Extraction Results ─────────────────────────────────────────────

/** Describes a single file that was created during extraction. */
export interface CreatedFile {
  /** Absolute path to the new file. */
  path: string;

  /** The function name that was moved here. */
  functionName: string;

  /** Full content of the new file. */
  content: string;
}

/** Describes a file whose imports were rewritten. */
export interface ModifiedFile {
  /** Absolute path to the modified file. */
  path: string;

  /** The original content before modification. */
  originalContent: string;

  /** The new content after import rewriting. */
  newContent: string;
}

/** The result of an extraction operation. */
export interface ExtractResult {
  /** New files created for extracted functions. */
  created: CreatedFile[];

  /** Existing files whose imports were updated. */
  modified: ModifiedFile[];

  /** Warnings (non-fatal issues encountered). */
  warnings: string[];

  /** Whether this was a dry run (no files written). */
  dryRun: boolean;
}
