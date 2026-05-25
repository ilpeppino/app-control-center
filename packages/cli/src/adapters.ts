import type { ContractEnvironment, ProjectContract } from "@control-center/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import { farmakomedAdapter } from "@control-center/adapter-farmakomed";

export interface FeatureControlAdapter {
  adapterName: string;
  readFeatureFlags(contract: ProjectContract): Promise<ProjectContract>;
  writeEnvironmentFlags(contract: ProjectContract, environment: ContractEnvironment): Promise<void>;
  managedFiles(contract: ProjectContract, environment: ContractEnvironment): string[];
}

const genericJsonAdapter: FeatureControlAdapter = {
  adapterName: "generic-json",
  async readFeatureFlags(contract) {
    return contract;
  },
  async writeEnvironmentFlags(contract, environment) {
    const values = Object.fromEntries(contract.featureFlags.map((flag) => [flag.key, environment === "dev" ? flag.devValue : flag.prdValue]));
    const filePath = path.isAbsolute(contract.flagFiles[environment])
      ? contract.flagFiles[environment]
      : path.join(contract.repoPath, contract.flagFiles[environment]);
    await writeJsonAtomic(filePath, values);
  },
  managedFiles(contract, environment) {
    return [
      path.isAbsolute(contract.flagFiles[environment])
        ? contract.flagFiles[environment]
        : path.join(contract.repoPath, contract.flagFiles[environment])
    ];
  }
};

export function resolveAdapter(contract: ProjectContract): FeatureControlAdapter {
  if (contract.adapterName === farmakomedAdapter.adapterName) {
    return farmakomedAdapter;
  }
  return genericJsonAdapter;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
