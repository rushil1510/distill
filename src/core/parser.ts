/**
 * Distill - Project parser
 *
 * Initializes a ts-morph Project from a tsconfig.json file.
 * The Project object is the root of all AST operations - it tracks
 * every source file, their imports, and enables cross-file reference
 * finding via the TypeScript compiler.
 *
 * Design decision: We create the Project lazily and cache it so that
 * multiple extract operations in the same session reuse the same
 * compiler instance.
 */

import { Project, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';

/** Cached project instance, keyed by absolute tsconfig path. */
const projectCache = new Map<string, Project>();

/**
 * Initialize (or retrieve from cache) a ts-morph Project.
 *
 * If a tsconfig.json exists at the given path, the project uses it.
 * Otherwise, a bare project is created with sensible defaults.
 *
 * @param tsconfigPath - Path to tsconfig.json (can be relative to cwd).
 * @returns A ts-morph Project ready for AST operations.
 */
export function getProject(tsconfigPath: string): Project {
  const absoluteTsconfig = path.resolve(tsconfigPath);

  // Return cached project if available
  if (projectCache.has(absoluteTsconfig)) {
    return projectCache.get(absoluteTsconfig)!;
  }

  let project: Project;

  if (fs.existsSync(absoluteTsconfig)) {
    logger.debug(`Loading project from ${absoluteTsconfig}`);
    project = new Project({
      tsConfigFilePath: absoluteTsconfig,
      skipAddingFilesFromTsConfig: false,
    });
  } else {
    logger.warn(`No tsconfig.json found at ${absoluteTsconfig}, using defaults`);
    project = new Project({
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
        strict: true,
        esModuleInterop: true,
      },
    });
  }

  projectCache.set(absoluteTsconfig, project);
  return project;
}

/**
 * Ensure a source file is loaded into the project.
 *
 * If the file isn't already tracked by the project (e.g., it's outside
 * the tsconfig includes), we add it explicitly.
 *
 * @param project  - The ts-morph Project.
 * @param filePath - Absolute path to the source file.
 * @returns The SourceFile AST node.
 * @throws If the file doesn't exist on disk.
 */
export function getSourceFile(project: Project, filePath: string): SourceFile {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  // Check if already in the project
  let sourceFile = project.getSourceFile(absolutePath);

  if (!sourceFile) {
    logger.debug(`Adding ${absolutePath} to project`);
    sourceFile = project.addSourceFileAtPath(absolutePath);
  }

  return sourceFile;
}

/**
 * Clear the project cache. Useful between test runs
 * or when the user modifies tsconfig.json.
 */
export function clearCache(): void {
  projectCache.clear();
}
