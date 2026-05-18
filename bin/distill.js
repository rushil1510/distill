#!/usr/bin/env node

/**
 * Distill CLI binary entry point.
 *
 * This file is referenced in package.json's "bin" field.
 * It simply loads the compiled CLI module and runs it.
 */

require('../dist/cli').program.parse(process.argv);
