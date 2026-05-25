import { describe, expect, it } from "vitest";
import { filterFlags, hasHighRiskProductionChange, pendingToChanges, type PendingChanges } from "./state";
import type { FeatureFlag, PreviewItem } from "./types";

const flags: FeatureFlag[] = [
  {
    key: "enableLocalAiSummary",
    label: "Local AI Summary",
    description: "Enables local summary generation.",
    category: "AI",
    type: "boolean",
    defaultValue: false,
    devValue: false,
    prdValue: false,
    risk: "low",
    requiresBuild: false
  },
  {
    key: "enableCaregiverMode",
    label: "Caregiver Mode",
    description: "Enables caregiver mode.",
    category: "Care",
    type: "boolean",
    defaultValue: false,
    devValue: true,
    prdValue: false,
    risk: "high",
    requiresBuild: true,
    owner: "Care Team"
  }
];

describe("dashboard state helpers", () => {
  it("converts pending values into API change requests", () => {
    const pending: PendingChanges = {
      enableLocalAiSummary: true,
      enableCaregiverMode: true
    };

    expect(pendingToChanges(flags, "dev", pending)).toEqual([
      { flagKey: "enableLocalAiSummary", value: true }
    ]);
  });

  it("filters flags by query, risk, and build requirement", () => {
    const result = filterFlags(flags, {
      query: "care",
      risk: "high",
      build: "requiresBuild"
    });

    expect(result.map((flag) => flag.key)).toEqual(["enableCaregiverMode"]);
  });

  it("detects high-risk production previews", () => {
    const previews: PreviewItem[] = [
      {
        change: {
          projectId: "demo",
          environment: "prd",
          flagKey: "enableCaregiverMode",
          from: false,
          to: true,
          flag: flags[1]
        },
        writes: [],
        warnings: []
      }
    ];

    expect(hasHighRiskProductionChange(previews)).toBe(true);
  });
});
