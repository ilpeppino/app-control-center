import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateProjectContract, type ProjectContract } from "./contract";

const validContract: ProjectContract = {
  projectId: "farmakomed",
  displayName: "FarmakoMed",
  adapterName: "farmakomed",
  repoPath: "/TODO/configure/local/farmakomed",
  environments: ["dev", "prd"],
  flagFiles: {
    dev: "config/feature-flags.dev.json",
    prd: "config/feature-flags.prd.json"
  },
  validationCommands: {
    dev: "echo Mock FarmakoMed dev validation passed",
    prd: "echo Mock FarmakoMed prd validation passed"
  },
  deployCommands: {
    dev: "echo Mock FarmakoMed dev deploy skipped",
    prd: "echo Mock FarmakoMed prd deploy skipped"
  },
  rollback: {
    snapshotPath: "projects/farmakomed/snapshots",
    retentionDays: 30
  },
  safetyRules: {
    productionRequiresConfirmation: true,
    highRiskProductionRequiresAcknowledgement: true,
    createRollbackSnapshotBeforeApply: true,
    blockDeployIfValidationFails: true
  },
  featureFlags: [
    {
      key: "prescriptions.interactionWarningsV2",
      label: "Interaction Warnings V2",
      description: "Uses the updated medication interaction warning engine.",
      category: "Prescriptions",
      type: "boolean",
      defaultValue: false,
      devValue: true,
      prdValue: false,
      risk: "high",
      requiresBuild: true,
      owner: "Clinical Safety",
      notes: "Requires clinical sign-off before production rollout."
    }
  ]
};

test("accepts a valid project contract", () => {
  const result = validateProjectContract(validContract);
  assert.equal(result.valid, true);
  assert.equal(result.valid && result.contract.projectId, "farmakomed");
});

test("accepts the FarmakoMed example contract", async () => {
  const contractPath = path.resolve(process.cwd(), "../../projects/farmakomed/project.contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as unknown;

  const result = validateProjectContract(contract);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("rejects contracts without required production safety confirmation", () => {
  const invalid = structuredClone(validContract);
  invalid.safetyRules.productionRequiresConfirmation = false as true;

  const result = validateProjectContract(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /productionRequiresConfirmation|must be equal to constant/);
});

test("rejects duplicate feature flag keys", () => {
  const invalid = structuredClone(validContract);
  invalid.featureFlags.push({ ...invalid.featureFlags[0] });

  const result = validateProjectContract(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /duplicate key/);
});

test("rejects unsupported environments", () => {
  const invalid = {
    ...validContract,
    environments: ["dev", "staging", "prd"]
  };

  const result = validateProjectContract(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /must be equal to one of the allowed values/);
});
