# Testing

## Coverage

The test suite covers:

- Registry models, exact type/value semantics, effective views, deletion, Revert, fingerprints, and SYSTEM + HKCU targeting.
- Current schema-7 Workspace/package parsing, round trips, ID collisions, and unsupported-version rejection.
- `.reg` parsing, supported encodings and types, partial imports, diagnostics, and file-size limits.
- Package validation and deterministic PowerShell, CSV, documentation, manifest, and ZIP generation.
- Read-only Detect/DryRun roles, idempotent mutation roles, exact CLR values, Unicode, profile targeting, and script inventories.
- Workspace operations, imports, downloads, runtime configuration, dialogs, focus, keyboard behavior, accessibility, and responsive layouts.
- Storage-free web and persistent Docker lifecycle boundaries.

## Local checks

Install dependencies with Node.js 22 or newer:

```bash
npm ci
```

Run the required validation checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run docs:check
```

Run one Vitest file with:

```bash
npm run test -- path/to/file.test.ts
```

## Browser suites

Install Chromium once:

```bash
npx playwright install chromium
```

Each browser command builds its matching artifact before running:

```bash
npm run test:browser:web
npm run test:browser:docker
```

The web suite verifies the production bundle, root and nested hosting, core import/review/download flows, accessibility, console errors, and zero calls to persistent storage APIs. The Docker suite verifies restore, autosave, reload, and stored-copy deletion.

### Viewport matrix

| Viewport   | Primary check                                        |
| ---------- | ---------------------------------------------------- |
| 1280 × 800 | Desktop application shell and content-pane scrolling |
| 960 × 668  | Laptop layout and natural document scrolling         |
| 720 × 800  | Compact footer and responsive content                |
| 390 × 844  | Narrow dialogs, help, focus, and overlays            |

## Container checks

```bash
docker build -t endpoint-registry-studio .
docker compose config
sh docker/smoke-test.sh endpoint-registry-studio
```

The smoke test verifies container health, security/cache headers for HTML, `config.json`, license/notice files, and hashed assets, plus the expected project and React license text.

## Manual Windows validation

Generated PowerShell cannot run in the browser test environment. Before release or production rollout, test representative packages on a non-production Windows device in the intended context and architecture. Confirm read-only detection, idempotent mutation, exact Registry types and views, deletion scope, HKCU profile targeting, Default User handling, and supported Win32 Revert behavior.
