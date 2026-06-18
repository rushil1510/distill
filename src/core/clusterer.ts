/**
 * Distill - Symbol clusterer
 *
 * Given an intra-file symbol graph (see symbol-graph.ts), find the
 * "responsibility clusters": groups of symbols that reference each other
 * (directly or transitively) but are independent of every other group.
 *
 * Each independent cluster is a candidate module to extract. A god-file with
 * many independent clusters is one that has accreted several unrelated
 * responsibilities and is a prime split candidate; a file that collapses to a
 * single cluster is genuinely cohesive and shouldn't be torn apart.
 *
 * The algorithm is classic union-find / connected-components, treating the
 * graph's directed reference edges as undirected:
 *   1. Assign each symbol an index.
 *   2. Union the endpoints of every edge.
 *   3. Group symbols by their find-root.
 *   4. Return components sorted largest-first (by line count).
 *
 * (This is the one idea worth porting from the CodeSleuth project, rewritten
 * from scratch here against Distill's real ts-morph symbol graph rather than
 * CodeSleuth's name-matching heuristic.)
 */

import { toFileName } from './naming';
import type {
  SymbolGraph,
  SymbolCluster,
  NamingConvention,
  FileSymbol,
} from '../types';

/**
 * Cluster a file's symbols into independent connected components.
 *
 * @param graph   - The intra-file symbol graph.
 * @param naming  - Naming convention for suggested module file names.
 * @returns Clusters sorted largest-first (by total line count).
 */
export function clusterSymbols(
  graph: SymbolGraph,
  naming: NamingConvention = 'camelCase'
): SymbolCluster[] {
  const names = Array.from(graph.symbols.keys());

  // ── Union-find over symbol indices ──────────────────────────────────────
  const indexOf = new Map<string, number>();
  names.forEach((name, i) => indexOf.set(name, i));

  const parent = names.map((_, i) => i);

  function find(i: number): number {
    // Path compression keeps the forest flat across repeated lookups.
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Treat every reference edge as undirected: a symbol and anything it
  // references belong to the same responsibility cluster.
  for (const [from, tos] of graph.edges) {
    const fi = indexOf.get(from);
    if (fi === undefined) continue;
    for (const to of tos) {
      const ti = indexOf.get(to);
      if (ti === undefined) continue;
      union(fi, ti);
    }
  }

  // ── Group symbols by their find-root ────────────────────────────────────
  const groups = new Map<number, string[]>();
  names.forEach((name, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(name);
    else groups.set(root, [name]);
  });

  // ── Materialize clusters with scoring metadata ──────────────────────────
  const clusters: SymbolCluster[] = [];
  for (const memberNames of groups.values()) {
    const members = memberNames
      .map((n) => graph.symbols.get(n)!)
      .sort((a, b) => a.startLine - b.startLine);

    const lineCount = members.reduce((sum, s) => sum + s.lineCount, 0);
    const hasExportedSymbol = members.some((s) => s.isExported);

    clusters.push({
      symbols: members.map((s) => s.name),
      lineCount,
      hasExportedSymbol,
      suggestedName: toFileName(pickClusterName(members), naming),
    });
  }

  // Largest clusters first — the biggest independent chunk is usually the
  // most worthwhile thing to pull out.
  clusters.sort((a, b) => b.lineCount - a.lineCount);
  return clusters;
}

/**
 * Choose a representative name for a cluster's suggested module file.
 *
 * Preference order: the largest exported symbol (it's part of the file's
 * public surface and most descriptive of the cluster's purpose), falling
 * back to the largest symbol overall.
 */
function pickClusterName(members: FileSymbol[]): string {
  const byLineDesc = [...members].sort((a, b) => b.lineCount - a.lineCount);
  const largestExported = byLineDesc.find((s) => s.isExported);
  return (largestExported ?? byLineDesc[0]).name;
}
