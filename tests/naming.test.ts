/**
 * Tests for the file naming convention converter.
 */

import { describe, it, expect } from 'vitest';
import { toFileName } from '../src/core/naming';

describe('toFileName', () => {
  describe('camelCase', () => {
    it('returns the function name unchanged', () => {
      expect(toFileName('calculateTax', 'camelCase')).toBe('calculateTax');
    });

    it('handles single-word names', () => {
      expect(toFileName('clamp', 'camelCase')).toBe('clamp');
    });
  });

  describe('kebab-case', () => {
    it('converts camelCase to kebab-case', () => {
      expect(toFileName('calculateTax', 'kebab-case')).toBe('calculate-tax');
    });

    it('handles multiple words', () => {
      expect(toFileName('formatCurrencyPrice', 'kebab-case')).toBe('format-currency-price');
    });

    it('handles acronyms gracefully', () => {
      expect(toFileName('parseHTMLDocument', 'kebab-case')).toBe('parse-html-document');
    });

    it('handles single word', () => {
      expect(toFileName('clamp', 'kebab-case')).toBe('clamp');
    });

    it('handles consecutive uppercase (API, URL)', () => {
      expect(toFileName('getAPIUrl', 'kebab-case')).toBe('get-api-url');
    });
  });

  describe('PascalCase', () => {
    it('capitalizes the first letter', () => {
      expect(toFileName('calculateTax', 'PascalCase')).toBe('CalculateTax');
    });

    it('preserves already PascalCase names', () => {
      expect(toFileName('CalculateTax', 'PascalCase')).toBe('CalculateTax');
    });

    it('handles single char', () => {
      expect(toFileName('a', 'PascalCase')).toBe('A');
    });

    it('handles empty string', () => {
      expect(toFileName('', 'PascalCase')).toBe('');
    });
  });
});
