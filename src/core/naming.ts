/**
 * Distill - File naming conventions
 *
 * Converts function names to file names based on the chosen convention.
 * This is a surprisingly important UX decision - the generated file names
 * should feel natural in the target codebase.
 *
 * Supported conventions:
 *   - camelCase:   calculateTax → calculateTax.ts
 *   - kebab-case:  calculateTax → calculate-tax.ts
 *   - PascalCase:  calculateTax → CalculateTax.ts
 */

import type { NamingConvention } from '../types';

/**
 * Convert a function name to a file name (without extension).
 *
 * @param functionName - The original function/variable name.
 * @param convention   - The naming convention to apply.
 * @returns The file name stem (no extension).
 *
 * @example
 * toFileName('calculateTax', 'kebab-case')  // → 'calculate-tax'
 * toFileName('calculateTax', 'PascalCase')  // → 'CalculateTax'
 * toFileName('calculateTax', 'camelCase')   // → 'calculateTax'
 */
export function toFileName(functionName: string, convention: NamingConvention): string {
  switch (convention) {
    case 'camelCase':
      return functionName;

    case 'kebab-case':
      return toKebabCase(functionName);

    case 'PascalCase':
      return toPascalCase(functionName);

    default:
      return functionName;
  }
}

/**
 * Convert camelCase or PascalCase to kebab-case.
 *
 * Handles consecutive uppercase letters (acronyms) gracefully:
 *   - parseHTMLDocument → parse-html-document
 *   - getAPIUrl → get-api-url
 */
function toKebabCase(str: string): string {
  return str
    // Insert hyphen before uppercase letters that follow lowercase
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    // Insert hyphen between consecutive uppercase and the next word
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Ensure the first character is uppercase (PascalCase).
 * Assumes input is already camelCase.
 */
function toPascalCase(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
