# Testing

## Coverage

The test suite covers:

- Registry models, exact type/value semantics, effective views, deletion, Revert, fingerprints, and SYSTEM + HKCU targeting.
- Current schema-8 Workspace/package parsing, administrative-template persistence, round trips, ID collisions, and unsupported-version rejection.
- `.reg` parsing, supported encodings and types, partial imports, diagnostics, and file-size limits.
- Package validation and deterministic PowerShell, CSV, documentation, manifest, and ZIP generation.
- Read-only Detect/DryRun roles, idempotent mutation roles, exact CLR values, Unicode, profile targeting, and script inventories.
- Workspace operations, imports, downloads, runtime configuration, dialogs, focus, keyboard behavior, accessibility, and responsive layouts.
- Storage-free web and persistent Docker lifecycle boundaries.
- Administrative-template eligibility, snapshot isolation, schema-safe draft CRUD, explicit metadata authoring, unload protection, compiler-gated preview/download, and rejected-item diagnostics including all-rejected inputs.
- Administrative-template duplicate Registry targets, including case-insensitive matches and the negative cases that must stay compilable, plus the locally detected overlap between template policies and enabled Deployment Package items, including recursive deletion scopes.
- Administrative-template navigation as a main-content view: the active navigator state, each of the three empty states and the action they offer, and unsaved authoring surviving a switch to the package list and back.
- Administrative-template source relationships: the package entry point preselecting only enabled items, the templates listed for a package, the source status for a policy, and adopting a changed source while keeping choices that still apply.
- The in-application guide: every topic is listed and reachable, the way back to work and to About, and that its examples use the product's own fictional vendor rather than a Microsoft placeholder.

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

The web suite verifies the production bundle, root and nested hosting, core import/review/download flows, Registry Item table overflow, accessibility, console errors, and zero calls to persistent storage APIs. The Docker suite verifies restore, autosave, reload, and stored-copy deletion.

### Viewport matrix

| Viewport   | Primary check                                                                       |
| ---------- | ----------------------------------------------------------------------------------- |
| 1280 × 800 | Desktop application shell, content-pane scrolling, and Registry Item table overflow |
| 960 × 668  | Laptop layout and natural document scrolling                                        |
| 720 × 800  | Compact footer and responsive content                                               |
| 390 × 844  | Narrow dialogs, help, focus, and overlays                                           |

## Container checks

```bash
docker build -t endpoint-registry-studio .
docker compose config
sh docker/smoke-test.sh endpoint-registry-studio
```

The smoke test verifies container health, security/cache headers for HTML, `config.json`, license/notice files, and hashed assets, plus the expected project and React license text.

## Manual Windows validation

Generated PowerShell cannot run in the browser test environment. Before release or production rollout, test representative packages on a non-production Windows device in the intended context and architecture. Confirm read-only detection, idempotent mutation, exact Registry types and views, deletion scope, HKCU profile targeting, Default User handling, and supported Win32 Revert behavior.
