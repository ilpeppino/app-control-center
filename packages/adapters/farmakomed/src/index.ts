import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContractEnvironment, ProjectContract } from "@control-center/core";

export const farmakomedAdapterName = "farmakomed";

export interface FarmakoMedAdapter {
  adapterName: typeof farmakomedAdapterName;
  readFeatureFlags(contract: ProjectContract): Promise<ProjectContract>;
  writeEnvironmentFlags(contract: ProjectContract, environment: ContractEnvironment): Promise<void>;
  managedFiles(contract: ProjectContract, environment: ContractEnvironment): string[];
}

export const farmakomedAdapter: FarmakoMedAdapter = {
  adapterName: farmakomedAdapterName,

  async readFeatureFlags(contract) {
    const devValues = await readFlagFile(resolveRepoFile(contract, contract.flagFiles.dev));
    const prdValues = await readFlagFile(resolveRepoFile(contract, contract.flagFiles.prd));

    return {
      ...contract,
      featureFlags: contract.featureFlags.map((flag) => ({
        ...flag,
        devValue: devValues[flag.key] ?? flag.devValue,
        prdValue: prdValues[flag.key] ?? flag.prdValue
      }))
    };
  },

  async writeEnvironmentFlags(contract, environment) {
    const filePath = resolveRepoFile(contract, contract.flagFiles[environment]);
    const values = Object.fromEntries(
      contract.featureFlags.map((flag) => [flag.key, environment === "dev" ? flag.devValue : flag.prdValue])
    ) as Record<string, boolean>;

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, formatFeatureFlagFile(values), "utf8");
  },

  managedFiles(contract, environment) {
    return [
      resolveRepoFile(contract, contract.flagFiles[environment])
    ];
  }
};

export async function readFlagFile(filePath: string): Promise<Record<string, boolean>> {
  const source = await fs.readFile(filePath, "utf8");
  const match = source.match(/featureFlags\s*(?::\s*FeatureFlags)?\s*=\s*\{([\s\S]*?)\}\s*(?:as const\s*)?;/);
  if (!match?.[1]) {
    throw new Error(`Unable to parse FarmakoMed feature flag file: ${filePath}`);
  }

  const values: Record<string, boolean> = {};
  const entryPattern = /([A-Za-z0-9_]+)\s*:\s*(true|false)\s*,?/g;
  for (const entry of match[1].matchAll(entryPattern)) {
    values[entry[1]] = entry[2] === "true";
  }
  return values;
}

export function formatFeatureFlagFile(values: Record<string, boolean>): string {
  const lines = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `  ${key}: ${String(value)},`);

  return [
    "import type { FeatureFlags } from './featureFlags';",
    "",
    "export const featureFlags: FeatureFlags = {",
    ...lines,
    "};",
    ""
  ].join("\n");
}

function resolveRepoFile(contract: ProjectContract, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(contract.repoPath, filePath);
}
