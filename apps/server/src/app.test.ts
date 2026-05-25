import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProjectContract } from "@control-center/core";
import { buildServer } from "./app";

async function createFixture(overrides: Partial<ProjectContract> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-api-"));
  const repoPath = path.join(root, "repo");
  const projectsDir = path.join(root, "projects");
  const projectDir = path.join(projectsDir, "demo");
  const contractPath = path.join(projectDir, "project.contract.json");
  const contract: ProjectContract = {
    projectId: "demo",
    displayName: "Demo",
    repoPath,
    environments: ["dev", "prd"],
    flagFiles: {
      dev: "flags.dev.json",
      prd: "flags.prd.json"
    },
    validationCommands: {
      dev: "echo dev validation ok",
      prd: "echo prd validation ok"
    },
    deployCommands: {
      dev: "echo dev deploy ok",
      prd: "echo prd deploy ok"
    },
    rollback: {
      snapshotPath: path.join(root, "snapshots")
    },
    safetyRules: {
      productionRequiresConfirmation: true,
      highRiskProductionRequiresAcknowledgement: true,
      createRollbackSnapshotBeforeApply: true,
      blockDeployIfValidationFails: true
    },
    featureFlags: [
      {
        key: "enableLocalAiSummary",
        label: "Local AI Summary",
        description: "Enables local summary generation.",
        category: "AI",
        type: "boolean",
        defaultValue: false,
        devValue: false,
        prdValue: false,
        risk: "low",
        requiresBuild: false
      },
      {
        key: "enableCaregiverMode",
        label: "Caregiver Mode",
        description: "Enables caregiver access workflows.",
        category: "Care",
        type: "boolean",
        defaultValue: false,
        devValue: false,
        prdValue: false,
        risk: "high",
        requiresBuild: true
      }
    ],
    ...overrides
  };

  await mkdir(projectDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  return {
    root,
    repoPath,
    projectsDir,
    contractPath,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("lists projects and flags", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const projects = await app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projects.statusCode, 200);
    assert.equal(projects.json().projects[0].projectId, "demo");

    const flags = await app.inject({ method: "GET", url: "/api/projects/demo/flags" });
    assert.equal(flags.statusCode, 200);
    assert.equal(flags.json().flags.length, 2);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("preview returns a diff without writing files", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const before = await readFile(fixture.contractPath, "utf8");
    const response = await app.inject({
      method: "POST",
      url: "/api/projects/demo/preview",
      payload: {
        environment: "dev",
        changes: [{ flagKey: "enableLocalAiSummary", value: true }]
      }
    });
    const after = await readFile(fixture.contractPath, "utf8");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().previews[0].change.from, false);
    assert.equal(response.json().previews[0].change.to, true);
    assert.equal(after, before);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("apply creates rollback snapshot before writing", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects/demo/apply",
      payload: {
        environment: "dev",
        changes: [{ flagKey: "enableLocalAiSummary", value: true }]
      }
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.json().results[0].snapshot.snapshotId, /^\d{4}/);

    const contract = JSON.parse(await readFile(fixture.contractPath, "utf8")) as ProjectContract;
    assert.equal(contract.featureFlags.find((flag) => flag.key === "enableLocalAiSummary")?.devValue, true);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("prd apply requires confirmation and high-risk acknowledgement", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const noConfirm = await app.inject({
      method: "POST",
      url: "/api/projects/demo/apply",
      payload: {
        environment: "prd",
        changes: [{ flagKey: "enableLocalAiSummary", value: true }]
      }
    });
    assert.equal(noConfirm.statusCode, 403);

    const noAck = await app.inject({
      method: "POST",
      url: "/api/projects/demo/apply",
      payload: {
        environment: "prd",
        confirmProduction: true,
        changes: [{ flagKey: "enableCaregiverMode", value: true }]
      }
    });
    assert.equal(noAck.statusCode, 403);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("validation failure blocks deploy", async () => {
  const fixture = await createFixture({
    validationCommands: {
      dev: "exit 9",
      prd: "echo ok"
    }
  });
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects/demo/deploy",
      payload: { environment: "dev" }
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().blocked, true);
    assert.equal(response.json().validation.exitCode, 9);
    assert.equal(response.json().deploy, undefined);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("rollback restores files from a known snapshot and snapshots can be listed", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir });
  try {
    const applied = await app.inject({
      method: "POST",
      url: "/api/projects/demo/apply",
      payload: {
        environment: "dev",
        changes: [{ flagKey: "enableLocalAiSummary", value: true }]
      }
    });
    const snapshotId = applied.json().results[0].snapshot.snapshotId;

    const snapshots = await app.inject({ method: "GET", url: "/api/projects/demo/snapshots" });
    assert.equal(snapshots.statusCode, 200);
    assert.equal(snapshots.json().snapshots[0].snapshotId, snapshotId);

    const rollback = await app.inject({
      method: "POST",
      url: "/api/projects/demo/rollback",
      payload: { snapshotId }
    });
    assert.equal(rollback.statusCode, 200);

    const contract = JSON.parse(await readFile(fixture.contractPath, "utf8")) as ProjectContract;
    assert.equal(contract.featureFlags.find((flag) => flag.key === "enableLocalAiSummary")?.devValue, false);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("optional API token protects routes", async () => {
  const fixture = await createFixture();
  const app = buildServer({ projectsDir: fixture.projectsDir, apiToken: "local-token" });
  try {
    const unauthorized = await app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: "Bearer local-token" }
    });
    assert.equal(authorized.statusCode, 200);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
