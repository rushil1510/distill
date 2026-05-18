# Contributing to Distill

We love your input! We want to make contributing to Distill as easy and transparent as possible, whether it's:
- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rushil1510/distill.git
   cd distill
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```
   *Note: This generates the `/dist` output required to run the CLI locally.*

4. **Run the test suite:**
   ```bash
   npm run test
   ```
   *We use Vitest. Ensure all tests (especially the end-to-end integration tests) pass before submitting a PR.*

## Local Testing

To test the CLI against a local project, you can use `node` to execute the built binary:

```bash
node ./bin/distill.js analyze /path/to/some/project/src/utils.ts
```

## Pull Request Process

1. Fork the repo and create your branch from `master`.
2. If you've added code that should be tested, add unit or integration tests in the `/tests` directory.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes (`npm run test`).
5. Issue that pull request!

## Code Architecture

Before contributing, please read [ARCHITECTURE.md](ARCHITECTURE.md) to understand how the AST traversal, dependency tracking, and import rewriting pipelines operate.

## Reporting Bugs

Please include:
- The version of Distill and TypeScript you are using.
- A minimal code snippet reproducing the AST extraction bug.
- What you expected to happen vs what actually happened.

## License
By contributing, you agree that your contributions will be licensed under its MIT License.
