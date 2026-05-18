<div align="center">
  <h1>Distill</h1>
  <p><strong>A token-efficient code modularization tool for AI agents and humans.</strong></p>
  <p>
    <a href="https://github.com/rushil1510/distill/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status" /></a>
    <a href="https://www.npmjs.com/package/distill-js"><img src="https://img.shields.io/npm/v/distill-js.svg" alt="npm version" /></a>
    <a href="https://github.com/rushil1510/distill/blob/master/LICENSE"><img src="https://img.shields.io/npm/l/distill-js.svg" alt="License" /></a>
  </p>
</div>

---

**Distill** is an AST-powered refactoring tool that extracts monolithic "god object" functions into their own single-responsibility modules, automatically rewriting all dependencies and imports project-wide. 

Built natively on [ts-morph](https://ts-morph.com/), it perfectly understands your TypeScript AST. It's designed to prepare codebases for AI-assisted development by reducing token context sizes and minimizing file coupling.

## Features

- **AST-Powered:** Perfect parsing of TypeScript and JSX/TSX.
- **Transitive Dependency Tracking:** Automatically co-extracts interfaces, constants, and helper functions required by your target function.
- **Global Import Rewriting:** Rewires all consumers of your function across the entire project to point to the new file path.
- **Safe Auto-Rollback:** Automatically runs `tsc --noEmit` post-extraction. If compilation fails, it surgically rolls back all changes.
- **MCP Server Included:** Natively exposes its capabilities as a Model Context Protocol tool server for seamless integration with Claude and other AI agents.
- **Agent-Friendly JSON:** Pass `--json` to get raw programmatic output instead of console tables.

## Installation

```bash
# Install globally
npm install -g distill-js

# Or run instantly via npx
npx distill-js --help
```

## Quick Start

### 1. Analyze a file
Find all extractable functions in a large utility file:

```bash
distill analyze src/utils.ts
```

### 2. Extract a function
Extract a specific function into its own module. Distill will create the new file, co-extract dependencies, remove it from the original file, and rewrite all imports project-wide.

```bash
distill extract src/utils.ts --function calculateTax --outdir src/helpers
```

### 3. Preview without modifying
View what will happen before touching your files:

```bash
distill extract src/utils.ts --function calculateTax --dry-run
```

## Configuration

Distill works out of the box, but you can configure it by creating a `distill.config.json` in your project root:

```json
{
  "tsconfig": "./tsconfig.json",
  "naming": "camelCase",
  "defaultOutDir": "./",
  "preserveBarrelExports": true,
  "exclude": ["**/node_modules/**", "**/dist/**", "**/*.test.ts"]
}
```

## MCP Tool Server

Distill ships with a built-in Model Context Protocol (MCP) server, allowing you to directly give AI agents the ability to analyze and refactor your codebase.

**Usage with Claude Desktop:**
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "distill": {
      "command": "npx",
      "args": ["-y", "distill-js", "mcp"]
    }
  }
}
```

## Documentation

For details into the project's architecture and contribution guidelines, see:
- [Architecture Overview](ARCHITECTURE.md)
- [Contributing Guidelines](CONTRIBUTING.md)

## License

MIT (c) [Rushil Mital](https://github.com/rushil1510)
