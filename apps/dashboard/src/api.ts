import type {
  ApplyResponse,
  ChangeRequest,
  DeployResponse,
  Environment,
  FlagsResponse,
  PreviewResponse,
  ProjectResponse,
  ProjectSummary,
  SnapshotsResponse,
  ValidationResponse
} from "./types";

const apiToken = import.meta.env.VITE_FEATURECTL_API_TOKEN as string | undefined;

interface ApiErrorPayload {
  error?: {
    message?: string;
    details?: unknown;
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (apiToken) {
    headers.set("Authorization", `Bearer ${apiToken}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new Error("Local API server is not reachable. Start it with npm run dev:server.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload;
    throw new Error(errorPayload.error?.message ?? `Request failed with status ${response.status}.`);
  }

  return payload as T;
}

export const api = {
  async listProjects(): Promise<ProjectSummary[]> {
    const payload = await request<{ projects: ProjectSummary[] }>("/api/projects");
    return payload.projects;
  },

  async getProject(projectId: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/api/projects/${projectId}`);
  },

  async listFlags(projectId: string): Promise<FlagsResponse> {
    return request<FlagsResponse>(`/api/projects/${projectId}/flags`);
  },

  async preview(projectId: string, environment: Environment, changes: ChangeRequest[]): Promise<PreviewResponse> {
    return request<PreviewResponse>(`/api/projects/${projectId}/preview`, {
      method: "POST",
      body: JSON.stringify({ environment, changes })
    });
  },

  async apply(projectId: string, environment: Environment, changes: ChangeRequest[], options: { confirmProduction?: boolean; acknowledgeHighRisk?: boolean }): Promise<ApplyResponse> {
    return request<ApplyResponse>(`/api/projects/${projectId}/apply`, {
      method: "POST",
      body: JSON.stringify({ environment, changes, ...options })
    });
  },

  async validate(projectId: string, environment: Environment): Promise<ValidationResponse> {
    return request<ValidationResponse>(`/api/projects/${projectId}/validate`, {
      method: "POST",
      body: JSON.stringify({ environment })
    });
  },

  async deploy(projectId: string, environment: Environment, confirmProduction?: boolean): Promise<DeployResponse> {
    return request<DeployResponse>(`/api/projects/${projectId}/deploy`, {
      method: "POST",
      body: JSON.stringify({ environment, confirmProduction })
    });
  },

  async rollback(projectId: string, snapshotId: string): Promise<{ projectId: string; restored: unknown }> {
    return request(`/api/projects/${projectId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ snapshotId })
    });
  },

  async listSnapshots(projectId: string): Promise<SnapshotsResponse> {
    return request<SnapshotsResponse>(`/api/projects/${projectId}/snapshots`);
  }
};
