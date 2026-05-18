import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { extract } from '../src/core/extractor';
import { DEFAULT_CONFIG } from '../src/utils/config';
import { clearCache, getProject } from '../src/core/parser';

describe('End-to-End Integration', () => {
  let tmpDir: string;
  let srcDir: string;
  let tsconfigPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distill-test-'));
    srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create tsconfig.json
    tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    fs.writeFileSync(tsconfigPath, JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        strict: true,
        esModuleInterop: true,
        outDir: "./dist"
      },
      include: ["src/**/*"]
    }));

    // Create a source file to extract from
    const utilsPath = path.join(srcDir, 'utils.ts');
    fs.writeFileSync(utilsPath, `
export const TAX_RATE = 0.2;

export interface Item { price: number; }

export function calculateTax(item: Item) {
  return item.price * TAX_RATE;
}

export function formatPrice(price: number) {
  return '$' + price.toFixed(2);
}
    `);

    // Create a consumer file
    const consumerPath = path.join(srcDir, 'consumer.ts');
    fs.writeFileSync(consumerPath, `
import { calculateTax, formatPrice, Item } from './utils';

const item: Item = { price: 100 };
console.log(formatPrice(calculateTax(item)));
    `);
  });

  afterAll(() => {
    clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts function, rewrites imports, and compiles successfully', async () => {
    const utilsPath = path.join(srcDir, 'utils.ts');

    const project = getProject(tsconfigPath);

    const result = await extract(
      {
        filePath: utilsPath,
        functions: ['calculateTax'],
        outDir: srcDir,
        naming: 'camelCase',
        dryRun: false,
        validate: true, // This will run tsc
      },
      { ...DEFAULT_CONFIG, tsconfig: tsconfigPath }
    );

    // Verify extraction result
    expect(result.created).toHaveLength(1);
    expect(result.created[0].path).toBe(path.join(srcDir, 'calculateTax.ts'));
    
    // Verify file system changes
    expect(fs.existsSync(result.created[0].path)).toBe(true);
    
    // Verify the new file contains the function and dependencies
    const newContent = fs.readFileSync(result.created[0].path, 'utf-8');
    expect(newContent).toContain('export const TAX_RATE');
    expect(newContent).toContain('export interface Item');
    expect(newContent).toContain('export function calculateTax');

    // Verify the consumer was updated
    const consumerContent = fs.readFileSync(path.join(srcDir, 'consumer.ts'), 'utf-8');
    expect(consumerContent).toContain("import { formatPrice, Item } from './utils';");
    expect(consumerContent).toMatch(/import \{ calculateTax \} from ['"]\.\/calculateTax['"]/);

    // Double check that it actually compiles by manually running tsc
    // (extract already ran it because validate=true, but we can assert it explicitly)
    expect(() => {
      execSync(`npx tsc --noEmit --project ${tsconfigPath}`, { stdio: 'ignore' });
    }).not.toThrow();
  });
});
