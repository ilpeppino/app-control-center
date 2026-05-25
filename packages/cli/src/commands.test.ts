import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProjectContract } from "@control-center/core";
import { applyChange, buildPreview, rollback, runDeploy } from "./commands";
import { loadProjectContract } from "./contracts";

async function createFixture(overrides: Partial<ProjectContract> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "featurectl-"));
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
        key: "highRiskPrdFlag",
        label: "High Risk",
        description: "High risk production flag.",
        category: "Safety",
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
    projectsDir,
    repoPath,
    contractPath,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("loads a valid contract", async () => {
  const fixture = await createFixture();
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    assert.equal(project.contract.displayName, "Demo");
  } finally {
    await fixture.cleanup();
  }
});

test("rejects an invalid contract", async () => {
  const fixture = await createFixture({ projectId: "Invalid ID" });
  try {
    await assert.rejects(() => loadProjectContract("demo", fixture.projectsDir), /Invalid project contract/);
  } finally {
    await fixture.cleanup();
  }
});

test("preview does not write files", async () => {
  const fixture = await createFixture();
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    const before = await readFile(fixture.contractPath, "utf8");
    const preview = buildPreview(project, "dev", "enableLocalAiSummary", true);
    const after = await readFile(fixture.contractPath, "utf8");
    assert.equal(preview.change.from, false);
    assert.equal(preview.change.to, true);
    assert.equal(after, before);
  } finally {
    await fixture.cleanup();
  }
});

test("apply creates a snapshot and writes flag files", async () => {
  const fixture = await createFixture();
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    const result = await applyChange(project, "dev", "enableLocalAiSummary", true);
    const contract = JSON.parse(await readFile(fixture.contractPath, "utf8")) as ProjectContract;
    const flagFile = JSON.parse(await readFile(path.join(fixture.repoPath, "flags.dev.json"), "utf8")) as Record<string, boolean>;
    assert.match(result.snapshot.snapshotId, /^\d{4}/);
    assert.equal(contract.featureFlags.find((flag) => flag.key === "enableLocalAiSummary")?.devValue, true);
    assert.equal(flagFile.enableLocalAiSummary, true);
  } finally {
    await fixture.cleanup();
  }
});

test("farmakomed adapter hydrates and writes TypeScript flag files", async () => {
  const fixture = await createFixture({
    projectId: "farmakomed",
    adapterName: "farmakomed",
    flagFiles: {
      dev: "src/services/features/featureFlags.dev.ts",
      prd: "src/services/features/featureFlags.prd.ts"
    },
    featureFlags: [
      {
        key: "advanced_ai_assistant",
        label: "Advanced AI Assistant",
        description: "Enables advanced AI assistance.",
        category: "AI",
        type: "boolean",
        defaultValue: false,
        devValue: false,
        prdValue: false,
        risk: "high",
        requiresBuild: true
      }
    ]
  });
  try {
    const flagDir = path.join(fixture.repoPath, "src/services/features");
    await mkdir(flagDir, { recursive: true });
    await writeFile(path.join(flagDir, "featureFlags.dev.ts"), "import type { FeatureFlags } from './featureFlags';\n\nexport const featureFlags: FeatureFlags = {\n  advanced_ai_assistant: false,\n};\n", "utf8");
    await writeFile(path.join(flagDir, "featureFlags.prd.ts"), "import type { FeatureFlags } from './featureFlags';\n\nexport const featureFlags: FeatureFlags = {\n  advanced_ai_assistant: false,\n};\n", "utf8");

    const project = await loadProjectContract("farmakomed", fixture.projectsDir);
    const result = await applyChange(project, "dev", "advanced_ai_assistant", true);
    const devFile = await readFile(path.join(flagDir, "featureFlags.dev.ts"), "utf8");

    assert.match(result.snapshot.snapshotId, /^\d{4}/);
    assert.match(devFile, /advanced_ai_assistant: true/);
  } finally {
    await fixture.cleanup();
  }
});

test("prd changes require confirmation", async () => {
  const fixture = await createFixture();
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    await assert.rejects(() => applyChange(project, "prd", "enableLocalAiSummary", true), /--confirm-prd/);
  } finally {
    await fixture.cleanup();
  }
});

test("validation failure blocks deploy", async () => {
  const fixture = await createFixture({
    validationCommands: {
      dev: "exit 7",
      prd: "echo ok"
    }
  });
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    const result = await runDeploy(project.contract, "dev");
    assert.equal(result.validation.exitCode, 7);
    assert.equal(result.deploy, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test("rollback restores previous file state", async () => {
  const fixture = await createFixture();
  try {
    const project = await loadProjectContract("demo", fixture.projectsDir);
    const applied = await applyChange(project, "dev", "enableLocalAiSummary", true);
    await rollback(project, applied.snapshot.snapshotId);
    const contract = JSON.parse(await readFile(fixture.contractPath, "utf8")) as ProjectContract;
    await assert.rejects(() => readFile(path.join(fixture.repoPath, "flags.dev.json"), "utf8"), /ENOENT/);
    assert.equal(contract.featureFlags.find((flag) => flag.key === "enableLocalAiSummary")?.devValue, false);
  } finally {
    await fixture.cleanup();
  }
});
