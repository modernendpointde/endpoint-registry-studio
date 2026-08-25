# Contributing

Contributions are welcome. Please keep changes focused and preserve the client-side, offline-capable architecture described in [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md).

## Workflow

1. Open an issue for significant changes or describe the problem clearly in the pull request.
2. Create a focused branch.
3. Install dependencies with Node.js 22 or newer:

   ```bash
   npm ci
   ```

4. Add tests for behavior changes and update affected documentation.
5. Run the relevant checks from [Testing](docs/TESTING.md). Before opening a pull request, run:

   ```bash
   npm run format:check
   npm run docs:check
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

Browser-facing changes should also run the matching browser suites. Container changes should run `docker build .`, `docker compose config`, and the container smoke test.

## Pull requests

Explain the user-visible change, tests performed, and any limitations. Avoid unrelated formatting or refactoring. New production dependencies require a clear purpose, license review, lockfile update, and any necessary change to [Third-party notices](THIRD_PARTY_NOTICES.md).
