import type { Environment, FeatureFlag, PreviewItem } from "./types";

export type PendingChanges = Record<string, boolean>;
export type RiskFilter = "all" | "low" | "medium" | "high";
export type BuildFilter = "all" | "requiresBuild" | "runtime";

export function valueForEnvironment(flag: FeatureFlag, environment: Environment): boolean {
  return environment === "dev" ? flag.devValue : flag.prdValue;
}

export function pendingValue(flag: FeatureFlag, environment: Environment, pending: PendingChanges): boolean {
  return pending[flag.key] ?? valueForEnvironment(flag, environment);
}

export function pendingToChanges(flags: FeatureFlag[], environment: Environment, pending: PendingChanges) {
  return flags
    .filter((flag) => pendingValue(flag, environment, pending) !== valueForEnvironment(flag, environment))
    .map((flag) => ({ flagKey: flag.key, value: pendingValue(flag, environment, pending) }));
}

export function hasHighRiskProductionChange(previews: PreviewItem[]): boolean {
  return previews.some((preview) => preview.change.environment === "prd" && preview.change.flag.risk === "high");
}

export function filterFlags(flags: FeatureFlag[], filters: { query: string; risk: RiskFilter; build: BuildFilter }): FeatureFlag[] {
  const query = filters.query.trim().toLowerCase();
  return flags.filter((flag) => {
    const matchesQuery = !query || [flag.key, flag.label, flag.description, flag.category, flag.owner ?? ""].some((value) => value.toLowerCase().includes(query));
    const matchesRisk = filters.risk === "all" || flag.risk === filters.risk;
    const matchesBuild = filters.build === "all" || (filters.build === "requiresBuild" ? flag.requiresBuild : !flag.requiresBuild);
    return matchesQuery && matchesRisk && matchesBuild;
  });
}

export function groupByCategory(flags: FeatureFlag[]): Record<string, FeatureFlag[]> {
  return flags.reduce<Record<string, FeatureFlag[]>>((groups, flag) => {
    groups[flag.category] = groups[flag.category] ?? [];
    groups[flag.category].push(flag);
    return groups;
  }, {});
}
