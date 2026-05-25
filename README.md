# Feature Flag Control Center

This repository currently contains the reusable project contract, CLI prototype, and local HTTP API for managing feature flags.

It does not include the dashboard UI yet. It also does not modify the real FarmakoMed app or run production deployment commands unless a project contract is explicitly configured to do so.

## Contract Files

```text
packages/core/schemas/project-contract.schema.json   JSON Schema
packages/core/src/contract.ts                        TypeScript types and validation
packages/core/src/contract.test.ts                   Basic contract tests
projects/farmakomed/project.contract.json            FarmakoMed example contract
packages/cli/src/index.ts                            featurectl CLI entrypoint
packages/cli/src/contracts.ts                        Contract loading and validation
packages/cli/src/commands.ts                         Preview, apply, deploy, rollback logic
packages/cli/src/commands.test.ts                    CLI behavior tests
apps/server/src/index.ts                             Local API entrypoint
apps/server/src/app.ts                               Fastify routes and request validation
apps/server/src/service.ts                           API service layer using CLI/core logic
apps/server/src/app.test.ts                          API route tests
apps/dashboard/src/main.tsx                          React dashboard UI
apps/dashboard/src/api.ts                            Local server API client
apps/dashboard/src/state.ts                          UI-only pending/filter helpers
apps/dashboard/src/styles.css                        Dashboard styling
packages/adapters/farmakomed/src/index.ts            FarmakoMed TypeScript flag-file adapter
docs/farmakomed-adapter-discovery.md                 FarmakoMed discovery report
```

## Run Locally

```bash
npm install
npm run test
npm run typecheck
npm run dev:server
npm run dev:dashboard
npm run dev
npm --workspace @control-center/cli run featurectl -- projects
```

CLI commands:

```bash
npm --workspace @control-center/cli run featurectl -- projects
npm --workspace @control-center/cli run featurectl -- flags --project farmakomed --env dev
npm --workspace @control-center/cli run featurectl -- preview --project farmakomed --env dev --flag billing.invoiceExport --value true
npm --workspace @control-center/cli run featurectl -- apply --project farmakomed --env dev --flag billing.invoiceExport --value true
npm --workspace @control-center/cli run featurectl -- validate --project farmakomed --env dev
npm --workspace @control-center/cli run featurectl -- deploy --project farmakomed --env dev
npm --workspace @control-center/cli run featurectl -- rollback --project farmakomed --snapshot latest
```

The FarmakoMed example contract still uses a placeholder `repoPath`, so commands that write files or execute commands need that path configured first.

## Dashboard

Run the API and dashboard together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:server
npm run dev:dashboard
```

The dashboard binds to `127.0.0.1` through Vite and proxies `/api` to `http://127.0.0.1:4545`. If `5173` is occupied, Vite will print the alternate localhost URL.

If the API token is enabled on the server, pass the same token to the dashboard:

```bash
FEATURECTL_API_TOKEN=local-token npm run dev:server
VITE_FEATURECTL_API_TOKEN=local-token npm run dev:dashboard
```

The dashboard only calls the local server API. It does not write files directly and does not execute shell commands directly.

Dashboard screens:

- Left sidebar with project and environment selection.
- Main categorized flag cards with search, risk filter, and build filter.
- Sticky pending changes bar with reset and preview actions.
- Preview modal with before/after diff, affected files, warnings, production confirmation, and high-risk acknowledgement.
- Deploy panel with validation, deploy action, latest validation status, and command logs.
- Rollback panel with snapshots, rollback latest, and rollback selected.

## Local API

Start the API:

```bash
npm run dev:server
```

The server binds to `127.0.0.1:4545` by default. Override only when you intentionally want a different local bind:

```bash
FEATURECTL_HOST=127.0.0.1 FEATURECTL_PORT=4545 npm run dev:server
```

Optional local API token:

```bash
FEATURECTL_API_TOKEN=local-token npm run dev:server
curl -H "Authorization: Bearer local-token" http://127.0.0.1:4545/api/projects
```

Routes:

```text
GET  /api/projects
GET  /api/projects/:projectId
GET  /api/projects/:projectId/flags
POST /api/projects/:projectId/preview
POST /api/projects/:projectId/apply
POST /api/projects/:projectId/validate
POST /api/projects/:projectId/deploy
POST /api/projects/:projectId/rollback
GET  /api/projects/:projectId/snapshots
```

Preview body:

```json
{
  "environment": "dev",
  "changes": [
    {
      "flagKey": "billing.invoiceExport",
      "value": true
    }
  ]
}
```

Production apply body:

```json
{
  "environment": "prd",
  "confirmProduction": true,
  "acknowledgeHighRisk": true,
  "changes": [
    {
      "flagKey": "enableCaregiverMode",
      "value": true
    }
  ]
}
```

Deploy body:

```json
{
  "environment": "dev"
}
```

Rollback body:

```json
{
  "snapshotId": "latest"
}
```

## Project Contract Shape

Each project provides one JSON contract:

```json
{
  "$schema": "../../packages/core/schemas/project-contract.schema.json",
  "projectId": "farmakomed",
  "displayName": "FarmakoMed",
  "adapterName": "farmakomed",
  "repoPath": "/TODO/configure/local/farmakomed",
  "environments": ["dev", "prd"],
  "flagFiles": {
    "dev": "config/feature-flags.dev.json",
    "prd": "config/feature-flags.prd.json"
  },
  "validationCommands": {
    "dev": "echo Mock FarmakoMed dev validation passed",
    "prd": "echo Mock FarmakoMed prd validation passed"
  },
  "deployCommands": {
    "dev": "echo Mock FarmakoMed dev deploy skipped",
    "prd": "echo Mock FarmakoMed prd deploy skipped"
  },
  "rollback": {
    "snapshotPath": "projects/farmakomed/snapshots",
    "retentionDays": 30
  },
  "safetyRules": {
    "productionRequiresConfirmation": true,
    "highRiskProductionRequiresAcknowledgement": true,
    "createRollbackSnapshotBeforeApply": true,
    "blockDeployIfValidationFails": true
  },
  "featureFlags": []
}
```

## Required Fields

`projectId`: Stable machine-readable project ID. Use lowercase letters, numbers, and hyphens.

`displayName`: Human-readable project name.

`repoPath`: Local filesystem path to the managed app repository.

`environments`: Initially supports `dev` and `prd`.

`flagFiles`: Per-environment flag file paths relative to `repoPath`.

`validationCommands`: Per-environment commands the framework must run before apply or deploy.

`deployCommands`: Per-environment deploy commands. FarmakoMed currently uses local Android APK artifact preparation commands, not cloud deployment.

`rollback.snapshotPath`: Local path where rollback snapshots are stored before file writes.

`featureFlags`: Feature flag definitions managed by the framework.

`adapterName`: Optional adapter identifier for projects that need custom behavior.

## Feature Flag Fields

```json
{
  "key": "prescriptions.interactionWarningsV2",
  "label": "Interaction Warnings V2",
  "description": "Uses the updated medication interaction warning engine.",
  "category": "Prescriptions",
  "type": "boolean",
  "defaultValue": false,
  "devValue": true,
  "prdValue": false,
  "risk": "high",
  "requiresBuild": true,
  "owner": "Clinical Safety",
  "notes": "Requires clinical sign-off before production rollout."
}
```

Supported `type` is currently `boolean`.

Supported `risk` values are `low`, `medium`, and `high`.

`owner` and `notes` are optional.

## Safety Rules

The schema requires these values to be `true`:

```json
{
  "productionRequiresConfirmation": true,
  "highRiskProductionRequiresAcknowledgement": true,
  "createRollbackSnapshotBeforeApply": true,
  "blockDeployIfValidationFails": true
}
```

This means a conforming project contract must declare that:

- Production changes require confirmation.
- High-risk production flags require explicit acknowledgement.
- Rollback snapshots are created before applying changes.
- Deploy is blocked when validation fails.

Runtime code still has to enforce these rules. The contract makes them mandatory project capabilities.

The CLI enforces these rules:
The CLI and API enforce these rules:

- `preview` never writes files.
- `apply` creates a rollback snapshot before writing.
- `deploy` runs validation first and does not run deploy when validation fails.
- `prd` apply requires `--confirm-prd`.
- High-risk `prd` apply requires both `--confirm-prd` and `--ack-high-risk`.
- `prd` deploy requires `--confirm-prd`.
- API production apply/deploy requires `"confirmProduction": true`.
- API high-risk production apply requires `"acknowledgeHighRisk": true`.

## Rollback Snapshots

Before `apply` writes anything, the CLI snapshots:

- The project contract file.
- The environment flag file configured in `flagFiles`.

Snapshots are stored under `rollback.snapshotPath` from the contract. Each snapshot contains a `manifest.json` plus captured files. Use:

```bash
npm --workspace @control-center/cli run featurectl -- rollback --project <projectId> --snapshot latest
```

or pass a specific snapshot ID.

## Validation API

Use `validateProjectContract` from `@control-center/core`:

```ts
import { validateProjectContract } from "@control-center/core";

const result = validateProjectContract(contractJson);

if (!result.valid) {
  console.error(result.errors);
}
```

Validation checks the JSON Schema and additional semantic rules, including duplicate feature flag keys.

## CLI Implementation Notes

The CLI is generic. It scans project contracts under `projects/*/project.contract.json`, validates each contract through `@control-center/core`, and uses the contract fields for file paths and commands.

It does not hardcode FarmakoMed behavior.

The current generic flag file writer outputs a JSON object mapping flag keys to boolean values for the selected environment:

```json
{
  "billing.invoiceExport": true
}
```

A future adapter can replace this with project-specific file transforms when needed.

## Adding a Project

1. Create `projects/<projectId>/project.contract.json`.
2. Point `$schema` to `packages/core/schemas/project-contract.schema.json`.
3. Configure `repoPath`, `flagFiles`, validation commands, deploy commands, rollback path, safety rules, and flags.
4. Keep deploy commands mocked until the project owner intentionally approves real deployment integration.
5. Add adapter code later only if the generic contract is not enough for that project.

## FarmakoMed Status

`projects/farmakomed/project.contract.json` is an example contract only.

It uses:

- Real local `repoPath`: `/Volumes/DevSSD/projects/farmakomed`.
- Real managed flag files: `src/services/features/featureFlags.dev.ts` and `src/services/features/featureFlags.prd.ts`.
- Validation command: `npm run ci:validate`.
- Deploy commands: `npm run build:android:apk:dev` and `npm run build:android:apk:prd`.
- Required production safety rules.

The deploy commands prepare local Android APK artifacts. They do not publish to a cloud service.
