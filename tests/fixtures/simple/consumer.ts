/**
 * A consumer file that imports functions from utils.ts.
 * Used to test that import rewriting works correctly.
 */

import { calculateTax, formatPrice } from './utils';

export function generateInvoice(amount: number): string {
  const taxResult = calculateTax(amount);
  const formatted = formatPrice(taxResult.total);
  return `Invoice: ${formatted} (includes tax: ${formatPrice(taxResult.tax)})`;
}
