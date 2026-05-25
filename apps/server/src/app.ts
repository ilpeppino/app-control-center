import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { ContractEnvironment } from "@control-center/core";
import { FeatureFlagService } from "./service";

const environmentSchema = z.enum(["dev", "prd"]);
const changeSchema = z.object({
  flagKey: z.string().min(1),
  value: z.boolean()
});
const mutationBodySchema = z.object({
  environment: environmentSchema,
  confirmProduction: z.boolean().optional(),
  acknowledgeHighRisk: z.boolean().optional(),
  changes: z.array(changeSchema).min(1)
});
const environmentBodySchema = z.object({
  environment: environmentSchema,
  confirmProduction: z.boolean().optional()
});
const rollbackBodySchema = z.object({
  snapshotId: z.string().min(1)
});

export interface BuildServerOptions {
  projectsDir?: string;
  apiToken?: string;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const projectsDir = options.projectsDir ?? path.resolve(new URL("../../..", import.meta.url).pathname, "projects");
  const apiToken = options.apiToken ?? process.env.FEATURECTL_API_TOKEN;
  const service = new FeatureFlagService({ projectsDir });

  if (apiToken) {
    app.addHook("preHandler", async (request, reply) => {
      const authHeader = request.headers.authorization;
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
      const headerToken = request.headers["x-api-token"];
      const token = bearer ?? (Array.isArray(headerToken) ? headerToken[0] : headerToken);
      if (token !== apiToken) {
        return reply.code(401).send({ error: { message: "Unauthorized." } });
      }
    });
  }

  app.get("/api/projects", async () => ({
    projects: await service.listProjects()
  }));

  app.get("/api/projects/:projectId", async (request) => {
    const { projectId } = projectParams(request);
    const project = await service.getProject(projectId);
    return {
      project: sanitizeProject(project.contract),
      contractPath: project.contractPath
    };
  });

  app.get("/api/projects/:projectId/flags", async (request) => {
    const { projectId } = projectParams(request);
    return {
      projectId,
      flags: await service.listFlags(projectId)
    };
  });

  app.post("/api/projects/:projectId/preview", async (request) => {
    const { projectId } = projectParams(request);
    const body = parseBody(mutationBodySchema, request.body);
    return {
      projectId,
      environment: body.environment,
      previews: await service.preview(projectId, body.environment, body.changes)
    };
  });

  app.post("/api/projects/:projectId/apply", async (request) => {
    const { projectId } = projectParams(request);
    const body = parseBody(mutationBodySchema, request.body);
    return {
      projectId,
      environment: body.environment,
      results: await service.apply(projectId, body.environment, body.changes, {
        confirmPrd: body.confirmProduction,
        acknowledgeHighRisk: body.acknowledgeHighRisk
      })
    };
  });

  app.post("/api/projects/:projectId/validate", async (request, reply) => {
    const { projectId } = projectParams(request);
    const body = parseBody(environmentBodySchema, request.body);
    const validation = await service.validate(projectId, body.environment);
    setExitStatus(reply, validation.exitCode);
    return { projectId, environment: body.environment, validation };
  });

  app.post("/api/projects/:projectId/deploy", async (request, reply) => {
    const { projectId } = projectParams(request);
    const body = parseBody(environmentBodySchema, request.body);
    const result = await service.deploy(projectId, body.environment, body.confirmProduction);
    if (result.blocked) {
      reply.code(422);
    } else if (result.deploy) {
      setExitStatus(reply, result.deploy.exitCode);
    }
    return { projectId, environment: body.environment, ...result };
  });

  app.post("/api/projects/:projectId/rollback", async (request) => {
    const { projectId } = projectParams(request);
    const body = parseBody(rollbackBodySchema, request.body);
    return {
      projectId,
      restored: await service.rollback(projectId, body.snapshotId)
    };
  });

  app.get("/api/projects/:projectId/snapshots", async (request) => {
    const { projectId } = projectParams(request);
    return {
      projectId,
      snapshots: await service.listSnapshots(projectId)
    };
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const statusCode = statusForError(error);
    await reply.code(statusCode).send({
      error: {
        message: safeErrorMessage(error),
        details: detailsForError(error)
      }
    });
  });

  return app;
}

function projectParams(request: FastifyRequest): { projectId: string } {
  return z.object({ projectId: z.string().min(1) }).parse(request.params);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function setExitStatus(reply: FastifyReply, exitCode: number): void {
  if (exitCode !== 0) {
    reply.code(422);
  }
}

function sanitizeProject(project: Awaited<ReturnType<FeatureFlagService["getProject"]>>["contract"]) {
  return {
    projectId: project.projectId,
    displayName: project.displayName,
    adapterName: project.adapterName,
    repoPath: project.repoPath,
    environments: project.environments,
    flagFiles: project.flagFiles,
    rollback: project.rollback,
    safetyRules: project.safetyRules,
    featureFlags: project.featureFlags
  };
}

function statusForError(error: Error): number {
  if (error instanceof z.ZodError) return 400;
  if (/not found/i.test(error.message)) return 404;
  if (/require[s]? --confirm-prd|require[s]? --ack-high-risk|Production deploy requires/.test(error.message)) return 403;
  if (/Invalid project contract/.test(error.message)) return 422;
  return 500;
}

function safeErrorMessage(error: Error): string {
  if (error instanceof z.ZodError) return "Invalid request.";
  return error.message;
}

function detailsForError(error: Error): unknown {
  if (error instanceof z.ZodError) return error.flatten();
  return undefined;
}
