/**
 * A sample "god file" with multiple functions that should be split up.
 * This is used as a test fixture for Distill.
 */

import { readFileSync } from 'fs';
import * as path from 'path';

// ── Constants ───────────────────────────────────────────────────────

const TAX_RATE = 0.18;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
};

// ── Types ───────────────────────────────────────────────────────────

interface TaxResult {
  amount: number;
  tax: number;
  total: number;
}

// ── Functions ───────────────────────────────────────────────────────

/**
 * Calculate tax on an amount.
 * Uses the module-level TAX_RATE constant.
 */
export function calculateTax(amount: number): TaxResult {
  const tax = amount * TAX_RATE;
  return {
    amount,
    tax,
    total: amount + tax,
  };
}

/**
 * Format a price with the appropriate currency symbol.
 */
export function formatPrice(amount: number, currency: string = 'USD'): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Read a config file from disk and parse it as JSON.
 */
export function loadConfig(configPath: string): Record<string, unknown> {
  const absolutePath = path.resolve(configPath);
  const content = readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * A small helper — too small to bother extracting.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * An unexported internal helper.
 */
function validateAmount(amount: number): boolean {
  return amount >= 0 && isFinite(amount);
}
