import { randomUUID } from "node:crypto";
import { execaCommand } from "execa";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContractEnvironment, ProjectContract } from "@control-center/core";
import type { ChangePreview, CommandOutput, FeatureChange, LoadedProjectContract, SnapshotManifest } from "./types";
import { writeContractFile, writeJsonAtomic } from "./contracts";
import { resolveAdapter } from "./adapters";

export interface SafetyOptions {
  confirmPrd?: boolean;
  acknowledgeHighRisk?: boolean;
}

export function buildPreview(project: LoadedProjectContract, environment: ContractEnvironment, flagKey: string, value: boolean): ChangePreview {
  const flag = project.contract.featureFlags.find((item) => item.key === flagKey);
  if (!flag) {
    throw new Error(`Flag not found: ${flagKey}`);
  }

  const valueField = environmentValueField(environment);
  const change: FeatureChange = {
    projectId: project.contract.projectId,
    environment,
    flagKey,
    from: flag[valueField],
    to: value,
    flag
  };

  const warnings: string[] = [];
  if (environment === "prd") {
    warnings.push("Production change requires explicit confirmation.");
  }
  if (environment === "prd" && flag.risk === "high") {
    warnings.push("High-risk production change requires explicit acknowledgement.");
  }
  if (flag.requiresBuild) {
    warnings.push("This flag requires a rebuild.");
  }

  return {
    change,
    writes: [
      project.contractPath,
      resolveRepoFile(project.contract, project.contract.flagFiles[environment])
    ],
    warnings
  };
}

export async function applyChange(project: LoadedProjectContract, environment: ContractEnvironment, flagKey: string, value: boolean, options: SafetyOptions = {}): Promise<{ preview: ChangePreview; snapshot: SnapshotManifest }> {
  const preview = buildPreview(project, environment, flagKey, value);
  enforceProductionSafety(preview, options);

  if (preview.change.from === preview.change.to) {
    return {
      preview,
      snapshot: await createRollbackSnapshot(project, environment, flagKey)
    };
  }

  const snapshot = await createRollbackSnapshot(project, environment, flagKey);
  const nextContract = updateContractFlag(project.contract, environment, flagKey, value);
  await writeContractFile(project.contractPath, nextContract);
  await writeEnvironmentFlagFile(nextContract, environment);
  project.contract = nextContract;
  return { preview, snapshot };
}

export async function rollback(project: LoadedProjectContract, snapshot: string): Promise<SnapshotManifest> {
  const snapshotId = snapshot === "latest" ? await findLatestSnapshotId(project.contract) : snapshot;
  const manifestPath = path.join(resolveSnapshotDir(project.contract), snapshotId, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest;

  for (const file of manifest.files) {
    if (file.existed) {
      await fs.mkdir(path.dirname(file.sourcePath), { recursive: true });
      await fs.copyFile(file.snapshotPath, file.sourcePath);
    } else {
      await fs.rm(file.sourcePath, { force: true });
    }
  }

  return manifest;
}

export async function listSnapshots(contract: ProjectContract): Promise<SnapshotManifest[]> {
  const dir = resolveSnapshotDir(contract);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  const snapshots: SnapshotManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "manifest.json");
    try {
      snapshots.push(JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function runValidation(contract: ProjectContract, environment: ContractEnvironment): Promise<CommandOutput> {
  return runCommand(contract.validationCommands[environment], contract.repoPath);
}

export async function runDeploy(contract: ProjectContract, environment: ContractEnvironment, options: Pick<SafetyOptions, "confirmPrd"> = {}): Promise<{ validation: CommandOutput; deploy?: CommandOutput }> {
  if (environment === "prd" && !options.confirmPrd) {
    throw new Error("Production deploy requires --confirm-prd.");
  }

  const validation = await runValidation(contract, environment);
  if (validation.exitCode !== 0) {
    return { validation };
  }

  return {
    validation,
    deploy: await runCommand(contract.deployCommands[environment], contract.repoPath)
  };
}

export function formatPreview(preview: ChangePreview): string {
  const lines = [
    `Project: ${preview.change.projectId}`,
    `Environment: ${preview.change.environment}`,
    `Flag: ${preview.change.flagKey}`,
    `Before: ${preview.change.from}`,
    `After: ${preview.change.to}`,
    "Writes on apply:",
    ...preview.writes.map((item) => `- ${item}`)
  ];

  if (preview.warnings.length > 0) {
    lines.push("Warnings:", ...preview.warnings.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

export function formatCommandOutput(output: CommandOutput): string {
  return [
    `Command: ${output.command}`,
    `Working directory: ${output.cwd}`,
    `Exit code: ${output.exitCode}`,
    output.stdout ? `stdout:\n${output.stdout.trimEnd()}` : "stdout: <empty>",
    output.stderr ? `stderr:\n${output.stderr.trimEnd()}` : "stderr: <empty>"
  ].join("\n");
}

async function runCommand(command: string, cwd: string): Promise<CommandOutput> {
  try {
    const result = await execaCommand(command, { shell: true, cwd, reject: false });
    return {
      command,
      cwd,
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const failure = error as Error;
    return {
      command,
      cwd,
      exitCode: 1,
      stdout: "",
      stderr: failure.message
    };
  }
}

export function enforceProductionSafety(preview: ChangePreview, options: SafetyOptions): void {
  if (preview.change.environment !== "prd") return;
  if (!options.confirmPrd) {
    throw new Error("Production changes require --confirm-prd.");
  }
  if (preview.change.flag.risk === "high" && !options.acknowledgeHighRisk) {
    throw new Error("High-risk production changes require --ack-high-risk.");
  }
}

async function createRollbackSnapshot(project: LoadedProjectContract, environment: ContractEnvironment, flagKey: string): Promise<SnapshotManifest> {
  const snapshotId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const snapshotDir = path.join(resolveSnapshotDir(project.contract), snapshotId);
  await fs.mkdir(snapshotDir, { recursive: true });

  const filesToCapture = [
    project.contractPath,
    ...resolveAdapter(project.contract).managedFiles(project.contract, environment)
  ];

  const files: SnapshotManifest["files"] = [];
  for (const sourcePath of filesToCapture) {
    const existed = await fileExists(sourcePath);
    const snapshotPath = path.join(snapshotDir, encodeURIComponent(sourcePath));
    if (existed) {
      await fs.copyFile(sourcePath, snapshotPath);
    }
    files.push({ sourcePath, snapshotPath, existed });
  }

  const manifest: SnapshotManifest = {
    snapshotId,
    createdAt: new Date().toISOString(),
    projectId: project.contract.projectId,
    contractPath: project.contractPath,
    environment,
    flagKey,
    files
  };

  await writeJsonAtomic(path.join(snapshotDir, "manifest.json"), manifest);
  return manifest;
}

async function findLatestSnapshotId(contract: ProjectContract): Promise<string> {
  const dir = resolveSnapshotDir(contract);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const latest = dirs.at(-1);
  if (!latest) {
    throw new Error(`No snapshots found in ${dir}`);
  }
  return latest;
}

function updateContractFlag(contract: ProjectContract, environment: ContractEnvironment, flagKey: string, value: boolean): ProjectContract {
  return {
    ...contract,
    featureFlags: contract.featureFlags.map((flag) => (
      flag.key === flagKey ? { ...flag, [environmentValueField(environment)]: value } : flag
    ))
  };
}

async function writeEnvironmentFlagFile(contract: ProjectContract, environment: ContractEnvironment): Promise<void> {
  await resolveAdapter(contract).writeEnvironmentFlags(contract, environment);
}

function environmentValueField(environment: ContractEnvironment): "devValue" | "prdValue" {
  return environment === "dev" ? "devValue" : "prdValue";
}

function resolveRepoFile(contract: ProjectContract, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(contract.repoPath, filePath);
}

function resolveSnapshotDir(contract: ProjectContract): string {
  return path.isAbsolute(contract.rollback.snapshotPath)
    ? contract.rollback.snapshotPath
    : path.resolve(process.cwd(), contract.rollback.snapshotPath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
