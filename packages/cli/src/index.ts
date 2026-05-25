#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import path from "node:path";
import type { ContractEnvironment } from "@control-center/core";
import { applyChange, buildPreview, formatCommandOutput, formatPreview, rollback, runDeploy, runValidation } from "./commands";
import { findProjectContracts, loadProjectContract } from "./contracts";

const program = new Command();
const defaultProjectsDir = path.resolve(new URL("../../..", import.meta.url).pathname, "projects");

program
  .name("featurectl")
  .description("Local Feature Flag Control Center CLI")
  .option("--projects-dir <dir>", "Directory containing project contracts", defaultProjectsDir);

program
  .command("projects")
  .description("List configured projects")
  .action(async () => {
    const contracts = await findProjectContracts(program.opts().projectsDir);
    if (contracts.length === 0) {
      console.log("No projects found.");
      return;
    }
    for (const { contract } of contracts) {
      console.log(`${contract.projectId}\t${contract.displayName}\t${contract.environments.join(",")}`);
    }
  });

program
  .command("flags")
  .description("List feature flags for a project and environment")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--env <env>", "Environment: dev or prd", parseEnvironment)
  .action(async (options: { project: string; env: ContractEnvironment }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    const field = options.env === "dev" ? "devValue" : "prdValue";
    for (const flag of project.contract.featureFlags) {
      console.log(`${flag.key}\t${flag[field]}\t${flag.risk}\t${flag.category}\t${flag.label}`);
    }
  });

program
  .command("preview")
  .description("Preview a feature flag change without writing files")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--env <env>", "Environment: dev or prd", parseEnvironment)
  .requiredOption("--flag <key>", "Feature flag key")
  .requiredOption("--value <boolean>", "New boolean value", parseBoolean)
  .action(async (options: { project: string; env: ContractEnvironment; flag: string; value: boolean }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    console.log(formatPreview(buildPreview(project, options.env, options.flag, options.value)));
  });

program
  .command("apply")
  .description("Apply a feature flag change with rollback snapshot")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--env <env>", "Environment: dev or prd", parseEnvironment)
  .requiredOption("--flag <key>", "Feature flag key")
  .requiredOption("--value <boolean>", "New boolean value", parseBoolean)
  .option("--confirm-prd", "Confirm production changes")
  .option("--ack-high-risk", "Acknowledge high-risk production changes")
  .action(async (options: { project: string; env: ContractEnvironment; flag: string; value: boolean; confirmPrd?: boolean; ackHighRisk?: boolean }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    const result = await applyChange(project, options.env, options.flag, options.value, {
      confirmPrd: options.confirmPrd,
      acknowledgeHighRisk: options.ackHighRisk
    });
    console.log(formatPreview(result.preview));
    console.log(`Snapshot: ${result.snapshot.snapshotId}`);
    console.log("Apply completed.");
  });

program
  .command("validate")
  .description("Run validation command for an environment")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--env <env>", "Environment: dev or prd", parseEnvironment)
  .action(async (options: { project: string; env: ContractEnvironment }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    const output = await runValidation(project.contract, options.env);
    console.log(formatCommandOutput(output));
    process.exitCode = output.exitCode;
  });

program
  .command("deploy")
  .description("Validate and run deploy command for an environment")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--env <env>", "Environment: dev or prd", parseEnvironment)
  .option("--confirm-prd", "Confirm production deploy")
  .action(async (options: { project: string; env: ContractEnvironment; confirmPrd?: boolean }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    const result = await runDeploy(project.contract, options.env, { confirmPrd: options.confirmPrd });
    console.log("Validation:");
    console.log(formatCommandOutput(result.validation));
    if (!result.deploy) {
      console.log("Deploy blocked because validation failed.");
      process.exitCode = result.validation.exitCode || 1;
      return;
    }
    console.log("Deploy:");
    console.log(formatCommandOutput(result.deploy));
    process.exitCode = result.deploy.exitCode;
  });

program
  .command("rollback")
  .description("Restore a rollback snapshot")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--snapshot <id>", "Snapshot ID or latest")
  .action(async (options: { project: string; snapshot: string }) => {
    const project = await loadProjectContract(options.project, program.opts().projectsDir);
    const manifest = await rollback(project, options.snapshot);
    console.log(`Restored snapshot: ${manifest.snapshotId}`);
    for (const file of manifest.files) {
      console.log(`- ${file.sourcePath}`);
    }
  });

program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof InvalidArgumentError) {
    console.error(error.message);
  } else if ((error as { code?: string }).code !== "commander.helpDisplayed") {
    console.error((error as Error).message);
  }
  process.exitCode = 1;
}

function parseEnvironment(value: string): ContractEnvironment {
  if (value === "dev" || value === "prd") return value;
  throw new InvalidArgumentError("Environment must be dev or prd.");
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidArgumentError("Value must be true or false.");
}
