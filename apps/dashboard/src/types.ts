import type { ContractEnvironment, ContractFeatureFlag, ProjectContract } from "@control-center/core";

export type Environment = ContractEnvironment;
export type FeatureFlag = ContractFeatureFlag;

export interface ProjectSummary {
  projectId: string;
  displayName: string;
  adapterName?: string;
  environments: Environment[];
}

export interface ProjectResponse {
  project: Omit<ProjectContract, "validationCommands" | "deployCommands">;
  contractPath: string;
}

export interface FlagsResponse {
  projectId: string;
  flags: FeatureFlag[];
}

export interface ChangeRequest {
  flagKey: string;
  value: boolean;
}

export interface PreviewItem {
  change: {
    projectId: string;
    environment: Environment;
    flagKey: string;
    from: boolean;
    to: boolean;
    flag: FeatureFlag;
  };
  writes: string[];
  warnings: string[];
}

export interface PreviewResponse {
  projectId: string;
  environment: Environment;
  previews: PreviewItem[];
}

export interface CommandLog {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  log: string;
}

export interface ValidationResponse {
  projectId: string;
  environment: Environment;
  validation: CommandLog;
}

export interface DeployResponse {
  projectId: string;
  environment: Environment;
  validation: CommandLog;
  deploy?: CommandLog;
  blocked: boolean;
}

export interface SnapshotManifest {
  snapshotId: string;
  createdAt: string;
  projectId: string;
  contractPath: string;
  environment: Environment;
  flagKey: string;
  files: Array<{
    sourcePath: string;
    snapshotPath: string;
    existed: boolean;
  }>;
}

export interface SnapshotsResponse {
  projectId: string;
  snapshots: SnapshotManifest[];
}

export interface ApplyResponse {
  projectId: string;
  environment: Environment;
  results: Array<{
    preview: PreviewItem;
    snapshot: SnapshotManifest;
  }>;
}
