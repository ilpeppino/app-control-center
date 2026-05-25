import { promises as fs } from "node:fs";
import path from "node:path";
import { validateProjectContract, type ProjectContract } from "@control-center/core";
import type { LoadedProjectContract } from "./types";
import { resolveAdapter } from "./adapters";

export async function findProjectContracts(projectsDir = path.resolve(process.cwd(), "projects")): Promise<LoadedProjectContract[]> {
  const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  const contracts: LoadedProjectContract[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const contractPath = path.join(projectsDir, entry.name, "project.contract.json");
    try {
      contracts.push(await loadContractFile(contractPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return contracts;
}

export async function loadProjectContract(projectId: string, projectsDir = path.resolve(process.cwd(), "projects")): Promise<LoadedProjectContract> {
  const contracts = await findProjectContracts(projectsDir);
  const project = contracts.find((item) => item.contract.projectId === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project;
}

export async function loadContractFile(contractPath: string): Promise<LoadedProjectContract> {
  const raw = await fs.readFile(contractPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const result = validateProjectContract(parsed);
  if (!result.valid) {
    throw new Error(`Invalid project contract at ${contractPath}:\n${result.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  return {
    contract: await resolveAdapter(result.contract).readFeatureFlags(result.contract),
    contractPath
  };
}

export async function writeContractFile(contractPath: string, contract: ProjectContract): Promise<void> {
  await writeJsonAtomic(contractPath, contract);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
