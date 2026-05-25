import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProjectContract } from "@control-center/core";
import { farmakomedAdapter, formatFeatureFlagFile, readFlagFile } from "./index";

test("parses FarmakoMed TypeScript flag files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farmakomed-adapter-"));
  try {
    const file = path.join(root, "featureFlags.dev.ts");
    await writeFile(file, formatFeatureFlagFile({ advanced_ai_assistant: true, caregiver_sync: false }), "utf8");
    assert.deepEqual(await readFlagFile(file), {
      advanced_ai_assistant: true,
      caregiver_sync: false
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hydrates and writes contract environment values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farmakomed-adapter-"));
  try {
    const devFile = path.join(root, "featureFlags.dev.ts");
    const prdFile = path.join(root, "featureFlags.prd.ts");
    await writeFile(devFile, formatFeatureFlagFile({ advanced_ai_assistant: true }), "utf8");
    await writeFile(prdFile, formatFeatureFlagFile({ advanced_ai_assistant: false }), "utf8");

    const contract: ProjectContract = {
      projectId: "farmakomed",
      displayName: "FarmakoMed",
      adapterName: "farmakomed",
      repoPath: root,
      environments: ["dev", "prd"],
      flagFiles: {
        dev: "featureFlags.dev.ts",
        prd: "featureFlags.prd.ts"
      },
      validationCommands: {
        dev: "echo ok",
        prd: "echo ok"
      },
      deployCommands: {
        dev: "echo deploy",
        prd: "echo deploy"
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
      featureFlags: [{
        key: "advanced_ai_assistant",
        label: "Advanced AI Assistant",
        description: "Enables advanced AI assistance.",
        category: "AI",
        type: "boolean",
        defaultValue: false,
        devValue: false,
        prdValue: false,
        risk: "high",
        requiresBuild: false
      }]
    };

    const hydrated = await farmakomedAdapter.readFeatureFlags(contract);
    assert.equal(hydrated.featureFlags[0]?.devValue, true);
    assert.equal(hydrated.featureFlags[0]?.prdValue, false);

    hydrated.featureFlags[0]!.devValue = false;
    await farmakomedAdapter.writeEnvironmentFlags(hydrated, "dev");
    assert.match(await readFile(devFile, "utf8"), /advanced_ai_assistant: false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
