export type EnvironmentId = "dev" | "prd";

export const environments: EnvironmentId[] = ["dev", "prd"];

export type RiskLevel = "low" | "medium" | "high";

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  category: string;
  devValue: boolean;
  prdValue: boolean;
  risk: RiskLevel;
  requiresBuild: boolean;
  owner?: string;
  notes?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  environments: EnvironmentId[];
}

export interface FlagChange {
  key: string;
  environment: EnvironmentId;
  from: boolean;
  to: boolean;
}

export interface PreviewResult {
  previewId: string;
  projectId: string;
  changes: FlagChange[];
  warnings: string[];
  requiresBuild: boolean;
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ApplyResult {
  snapshotId: string;
  preview: PreviewResult;
  validation: CommandResult;
  flags: FeatureFlag[];
}

export interface DeployResult {
  validation?: CommandResult;
  deployment: CommandResult;
}

export interface RollbackResult {
  snapshotId: string;
  restoredFlags: FeatureFlag[];
}

export interface ProjectAdapter {
  project: ProjectSummary;
  flagsFile: string;
  targetFiles: string[];
  loadFlags(): Promise<FeatureFlag[]>;
  saveFlags(flags: FeatureFlag[]): Promise<void>;
  validate(environment: EnvironmentId): Promise<CommandResult>;
  deploy(environment: EnvironmentId): Promise<CommandResult>;
}

export function valueFieldForEnvironment(environment: EnvironmentId): "devValue" | "prdValue" {
  return environment === "dev" ? "devValue" : "prdValue";
}

export function groupFlagsByCategory(flags: FeatureFlag[]): Record<string, FeatureFlag[]> {
  return flags.reduce<Record<string, FeatureFlag[]>>((groups, flag) => {
    groups[flag.category] = groups[flag.category] ?? [];
    groups[flag.category].push(flag);
    return groups;
  }, {});
}

export function applyFlagChanges(flags: FeatureFlag[], changes: FlagChange[]): FeatureFlag[] {
  return flags.map((flag) => {
    const next = { ...flag };
    for (const change of changes.filter((item) => item.key === flag.key)) {
      next[valueFieldForEnvironment(change.environment)] = change.to;
    }
    return next;
  });
}

export function buildPreview(projectId: string, flags: FeatureFlag[], requested: Array<Pick<FlagChange, "key" | "environment" | "to">>, previewId: string): PreviewResult {
  const changes: FlagChange[] = [];
  const warnings: string[] = [];

  for (const request of requested) {
    const flag = flags.find((item) => item.key === request.key);
    if (!flag) {
      throw new Error(`Unknown flag: ${request.key}`);
    }

    const field = valueFieldForEnvironment(request.environment);
    const from = flag[field];
    if (from === request.to) {
      continue;
    }

    changes.push({
      key: flag.key,
      environment: request.environment,
      from,
      to: request.to
    });

    if (request.environment === "prd" && flag.risk === "high") {
      warnings.push(`High-risk production change: ${flag.label}`);
    } else if (request.environment === "prd") {
      warnings.push(`Production change: ${flag.label}`);
    }

    if (flag.requiresBuild) {
      warnings.push(`Requires rebuild: ${flag.label}`);
    }
  }

  return {
    previewId,
    projectId,
    changes,
    warnings: Array.from(new Set(warnings)),
    requiresBuild: changes.some((change) => {
      const flag = flags.find((item) => item.key === change.key);
      return Boolean(flag?.requiresBuild);
    })
  };
}

export * from "./contract";
