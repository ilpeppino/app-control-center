import {
  applyChange,
  buildPreview,
  enforceProductionSafety,
  formatCommandOutput,
  listSnapshots,
  rollback,
  runDeploy,
  runValidation,
  type SafetyOptions
} from "@control-center/cli/commands";
import { findProjectContracts, loadProjectContract } from "@control-center/cli/contracts";
import type { ContractEnvironment } from "@control-center/core";
import type { ChangePreview, CommandOutput, LoadedProjectContract, SnapshotManifest } from "@control-center/cli/types";

export interface FlagMutation {
  flagKey: string;
  value: boolean;
}

export interface FeatureServiceOptions {
  projectsDir: string;
}

export class FeatureFlagService {
  constructor(private readonly options: FeatureServiceOptions) {}

  async listProjects() {
    const projects = await findProjectContracts(this.options.projectsDir);
    return projects.map(({ contract }) => ({
      projectId: contract.projectId,
      displayName: contract.displayName,
      adapterName: contract.adapterName,
      environments: contract.environments
    }));
  }

  async getProject(projectId: string) {
    return this.load(projectId);
  }

  async listFlags(projectId: string) {
    const project = await this.load(projectId);
    return project.contract.featureFlags;
  }

  async preview(projectId: string, environment: ContractEnvironment, changes: FlagMutation[]) {
    const project = await this.load(projectId);
    return changes.map((change) => buildPreview(project, environment, change.flagKey, change.value));
  }

  async apply(projectId: string, environment: ContractEnvironment, changes: FlagMutation[], safety: SafetyOptions) {
    const project = await this.load(projectId);

    // Validate every requested change before the first write.
    for (const change of changes) {
      enforceProductionSafety(buildPreview(project, environment, change.flagKey, change.value), safety);
    }

    const results: Array<{ preview: ChangePreview; snapshot: SnapshotManifest }> = [];
    for (const change of changes) {
      results.push(await applyChange(project, environment, change.flagKey, change.value, safety));
    }

    return results;
  }

  async validate(projectId: string, environment: ContractEnvironment) {
    const project = await this.load(projectId);
    return withReadableLog(await runValidation(project.contract, environment));
  }

  async deploy(projectId: string, environment: ContractEnvironment, confirmPrd?: boolean) {
    const project = await this.load(projectId);
    const result = await runDeploy(project.contract, environment, { confirmPrd });
    return {
      validation: withReadableLog(result.validation),
      deploy: result.deploy ? withReadableLog(result.deploy) : undefined,
      blocked: !result.deploy
    };
  }

  async rollback(projectId: string, snapshotId: string) {
    const project = await this.load(projectId);
    return rollback(project, snapshotId);
  }

  async listSnapshots(projectId: string) {
    const project = await this.load(projectId);
    return listSnapshots(project.contract);
  }

  private async load(projectId: string): Promise<LoadedProjectContract> {
    return loadProjectContract(projectId, this.options.projectsDir);
  }
}

function withReadableLog(output: CommandOutput): CommandOutput & { log: string } {
  return {
    ...output,
    log: formatCommandOutput(output)
  };
}
