import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import projectContractSchema from "../schemas/project-contract.schema.json" assert { type: "json" };

export type ContractEnvironment = "dev" | "prd";
export type ContractRiskLevel = "low" | "medium" | "high";
export type FeatureFlagType = "boolean";

export interface ContractFeatureFlag {
  key: string;
  label: string;
  description: string;
  category: string;
  type: FeatureFlagType;
  defaultValue: boolean;
  devValue: boolean;
  prdValue: boolean;
  risk: ContractRiskLevel;
  requiresBuild: boolean;
  owner?: string;
  notes?: string;
}

export interface ProductionSafetyRules {
  productionRequiresConfirmation: true;
  highRiskProductionRequiresAcknowledgement: true;
  createRollbackSnapshotBeforeApply: true;
  blockDeployIfValidationFails: true;
}

export interface RollbackContract {
  snapshotPath: string;
  retentionDays?: number;
}

export interface ProjectContract {
  $schema?: string;
  projectId: string;
  displayName: string;
  adapterName?: string;
  repoPath: string;
  environments: ContractEnvironment[];
  flagFiles: Record<ContractEnvironment, string>;
  validationCommands: Record<ContractEnvironment, string>;
  deployCommands: Record<ContractEnvironment, string>;
  rollback: RollbackContract;
  safetyRules: ProductionSafetyRules;
  featureFlags: ContractFeatureFlag[];
}

export interface ContractValidationSuccess {
  valid: true;
  contract: ProjectContract;
  errors: [];
}

export interface ContractValidationFailure {
  valid: false;
  errors: string[];
  rawErrors: ErrorObject[];
}

export type ContractValidationResult = ContractValidationSuccess | ContractValidationFailure;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});
addFormats(ajv);

const validateProjectContractSchema = ajv.compile<ProjectContract>(projectContractSchema);

export function validateProjectContract(input: unknown): ContractValidationResult {
  const schemaValid = validateProjectContractSchema(input);
  if (!schemaValid) {
    return {
      valid: false,
      errors: formatAjvErrors(validateProjectContractSchema.errors ?? []),
      rawErrors: validateProjectContractSchema.errors ?? []
    };
  }

  const semanticErrors = validateContractSemantics(input);
  if (semanticErrors.length > 0) {
    return {
      valid: false,
      errors: semanticErrors,
      rawErrors: []
    };
  }

  return {
    valid: true,
    contract: input,
    errors: []
  };
}

function validateContractSemantics(contract: ProjectContract): string[] {
  const errors: string[] = [];
  const environments = new Set(contract.environments);
  const flagKeys = new Set<string>();

  if (!environments.has("dev")) {
    errors.push("environments must include dev.");
  }

  if (!environments.has("prd")) {
    errors.push("environments must include prd.");
  }

  for (const field of ["flagFiles", "validationCommands", "deployCommands"] as const) {
    for (const environment of contract.environments) {
      if (!contract[field][environment]) {
        errors.push(`${field}.${environment} is required for configured environment ${environment}.`);
      }
    }
  }

  for (const flag of contract.featureFlags) {
    if (flagKeys.has(flag.key)) {
      errors.push(`featureFlags contains duplicate key: ${flag.key}.`);
    }
    flagKeys.add(flag.key);
  }

  return errors;
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

export { projectContractSchema };
