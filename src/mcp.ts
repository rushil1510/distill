#!/usr/bin/env node

/**
 * Distill - MCP Tool Server
 *
 * Exposes Distill's capabilities to AI agents via the Model Context Protocol.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { distill } from './index';

// Create the MCP server
const server = new McpServer({
  name: 'Distill Refactoring Server',
  version: '0.1.0'
});

// Tool: analyze
server.tool(
  'distill_analyze',
  'Analyze a TypeScript file to find extractable functions',
  {
    filePath: z.string().describe('Absolute path to the source file'),
    match: z.string().optional().describe('Optional regex to filter function names'),
    minLines: z.number().optional().describe('Minimum lines of code to consider'),
  },
  async ({ filePath, match, minLines }) => {
    try {
      let functions = distill.analyze(filePath);
      
      if (match) {
        const re = new RegExp(match);
        functions = functions.filter(f => re.test(f.name));
      }
      if (minLines !== undefined) {
        functions = functions.filter(f => f.lineCount >= minLines);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(functions, null, 2) }]
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: extract
server.tool(
  'distill_extract',
  'Extract functions from a file into their own single-responsibility modules and rewrite project imports',
  {
    filePath: z.string().describe('Absolute path to the source file'),
    functions: z.array(z.string()).optional().describe('Specific function names to extract'),
    match: z.string().optional().describe('Regex to match function names to extract'),
    outDir: z.string().optional().describe('Output directory for the new modules (relative or absolute)'),
    naming: z.enum(['camelCase', 'kebab-case', 'PascalCase']).optional().describe('File naming convention'),
    dryRun: z.boolean().optional().describe('If true, previews changes without writing to disk'),
    validate: z.boolean().optional().describe('If false, skips post-extraction tsc validation'),
  },
  async ({ filePath, functions, match, outDir, naming, dryRun, validate }) => {
    try {
      const result = await distill.extract({
        filePath,
        functions,
        match,
        outDir,
        naming,
        dryRun,
        validate
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: suggest
server.tool(
  'distill_suggest',
  'Recommend how to split god-files into single-responsibility modules. ' +
    'Omit filePath to scan the whole project and rank the worst offenders; ' +
    'pass a filePath to get the split plan (independent symbol clusters) for one file. ' +
    'Pair this with distill_extract to execute an accepted suggestion.',
  {
    filePath: z
      .string()
      .optional()
      .describe('Absolute path to a single file. Omit to scan the whole project.'),
    top: z
      .number()
      .optional()
      .describe('When scanning a project, return only the N worst files'),
  },
  async ({ filePath, top }) => {
    try {
      if (filePath) {
        const suggestion = distill.suggest(filePath);
        return {
          content: [{ type: 'text', text: JSON.stringify(suggestion, null, 2) }],
        };
      }

      let suggestions = distill
        .suggestProject()
        .filter((s) => s.clusterCount >= 2);
      if (top !== undefined) suggestions = suggestions.slice(0, top);

      return {
        content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Start the server using stdio transport
async function start() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Distill MCP Server running on stdio');
}

// Only start if executed directly
if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error in MCP server:', err);
    process.exit(1);
  });
}

export { server };
