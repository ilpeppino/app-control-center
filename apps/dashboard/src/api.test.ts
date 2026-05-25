import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api client", () => {
  it("sends preview requests to the local server API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projectId: "demo", environment: "dev", previews: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.preview("demo", "dev", [{ flagKey: "enableLocalAiSummary", value: true }]);

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/demo/preview", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        environment: "dev",
        changes: [{ flagKey: "enableLocalAiSummary", value: true }]
      })
    }));
  });

  it("returns a clear error when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect failed")));

    await expect(api.listProjects()).rejects.toThrow("Local API server is not reachable");
  });
});
