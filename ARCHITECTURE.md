# Architecture Overview

Distill is a Node.js command-line application and programmable library that relies heavily on [ts-morph](https://ts-morph.com/) (a wrapper around the TypeScript Compiler API) to traverse and mutate Abstract Syntax Trees (ASTs).

## Core Philosophy

Codebases grow naturally into monolithic utility files (e.g., `utils.ts`, `helpers.ts`). Manually breaking these apart is tedious and prone to breaking builds due to missed dependencies or forgotten import updates. Distill automates this entire lifecycle, safely resolving both internal (in-file) and external dependencies.

## System Components

```text
src/
├── cli.ts                  # Commander.js CLI entry points
├── mcp.ts                  # Model Context Protocol (MCP) server
├── index.ts                # Programmatic library exports
├── types.ts                # Centralized interfaces and types
├── core/
│   ├── parser.ts           # ts-morph project initialization & caching
│   ├── analyzer.ts         # Identifies extractable functions in a file
│   ├── dependency-analyzer # AST walking for transitive dependency graphs
│   ├── symbol-graph.ts     # Intra-file symbol reference graph (all top-level symbols)
│   ├── clusterer.ts        # Union-find connected components → responsibility clusters
│   ├── suggester.ts        # God-file scoring + ranking (the `suggest` engine)
│   ├── extractor.ts        # The main orchestrator
│   ├── import-rewriter.ts  # Project-wide import updates
│   └── naming.ts           # File naming conventions (camelCase, etc.)
└── utils/
    ├── config.ts           # cosmiconfig resolution
    └── logger.ts           # Console formatting
```

## The Suggestion Pipeline

`distill extract` answers *"extract this function safely."* `distill suggest` answers the question that comes before it: *"what should I extract, and from where?"*

1. **Symbol graph (`symbol-graph.ts`):** For a file, enumerate every top-level symbol (functions, variables, types, interfaces, enums, classes) and draw an edge from A to B whenever A's declaration references B. It reuses the dependency-analyzer's exact reference-collection helpers, so edges share the same semantics the extraction pipeline already trusts. Imports and locally-scoped parameter names are excluded.
2. **Clustering (`clusterer.ts`):** Run union-find connected-components over that graph (treating edges as undirected). Each connected component is a group of symbols that belong together but are independent of the rest of the file — a candidate module. Clusters are returned largest-first.
3. **Scoring (`suggester.ts`):** Rank files by `lineCount × (clusterCount − 1) + (fanIn + fanOut)`. The dominant term surfaces files that are both large *and* fragmented; coupling (computed via real `getModuleSpecifierSourceFile()` resolution, not string matching) breaks ties. A cohesive single-cluster file scores its coupling only and won't be recommended for splitting.

The output is a per-file plan that maps directly onto the existing `extract` command, completing the **find the mess → propose the split → execute it safely** loop.

## The Extraction Pipeline

When `distill extract` is invoked, the `extractor.ts` orchestrator runs the following pipeline:

### 1. Analysis Phase
- Initializes a `ts-morph` `Project` using the local `tsconfig.json`.
- Identifies the target function(s) in the specified source file.
- **Dependency Resolution (`dependency-analyzer.ts`):** 
  - Walks the target function's AST to find all referenced identifiers.
  - Recursively follows identifiers to resolve **transitive dependencies** (e.g., if `A` depends on `B`, and `B` depends on `C`, all are flagged for co-extraction).
  - Classifies dependencies into:
    - `inFileDeps`: Things defined in the same file (interfaces, constants, other functions).
    - `requiredImports`: External imports from other modules.

### 2. Pre-Computation Phase
- The engine pre-computes the exact content of the new files in memory.
- `inFileDeps` are modified on the fly to ensure they have the `export` keyword so they can be consumed by the newly created file and the original file.
- New file paths are generated based on the selected `NamingConvention`.

### 3. Mutation Phase
- The target function is ripped out of the original source AST via `node.remove()`.
- An `import` statement is inserted into the original source file, importing the now-externalized function from its new location.
- If configured, a barrel re-export is maintained to prevent breaking existing consumers unnecessarily.

### 4. Global Import Rewriting (`import-rewriter.ts`)
- Distill scans every file in the `ts-morph` project.
- It leverages TypeScript's native module resolution (`getModuleSpecifierSourceFile()`) to safely identify imports pointing to the original monolithic file.
- It parses the `NamedImports` and seamlessly rewrites them to point to the newly extracted file paths, resolving relative pathing mathematically.

### 5. Validation & Rollback
- Writes the mutated ASTs and new files to the physical file system.
- Spawns a synchronous `npx tsc --noEmit --project tsconfig.json` child process.
- **Rollback:** If TypeScript reports *any* compilation errors, Distill immediately deletes the new files and restores the original file contents from memory, ensuring zero destructive risk to the codebase.
- Finally, it drops a `.distill/extract-<timestamp>.json` manifest for future undo/cleanup support.

## Design Decisions

- **In-Memory AST vs Regex:** We strictly use AST manipulation instead of regex. While slower, it guarantees semantic correctness (e.g., distinguishing between a variable named `Tax` and a string literal `"Tax"`).
- **Rollback Over Guarantees:** Because TypeScript AST mutation is incredibly complex, we opted for a fail-safe validation loop rather than trying to perfectly predict every edge case. If Distill messes up, it reverts itself.
