import type { ContractEnvironment, ContractFeatureFlag, ProjectContract } from "@control-center/core";

export interface LoadedProjectContract {
  contract: ProjectContract;
  contractPath: string;
}

export interface FeatureChange {
  projectId: string;
  environment: ContractEnvironment;
  flagKey: string;
  from: boolean;
  to: boolean;
  flag: ContractFeatureFlag;
}

export interface ChangePreview {
  change: FeatureChange;
  writes: string[];
  warnings: string[];
}

export interface CommandOutput {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SnapshotManifest {
  snapshotId: string;
  createdAt: string;
  projectId: string;
  contractPath: string;
  environment: ContractEnvironment;
  flagKey: string;
  files: Array<{
    sourcePath: string;
    snapshotPath: string;
    existed: boolean;
  }>;
}
