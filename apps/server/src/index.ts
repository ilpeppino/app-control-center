import { buildServer } from "./app";

const host = process.env.FEATURECTL_HOST ?? "127.0.0.1";
const port = Number(process.env.FEATURECTL_PORT ?? 4545);

const app = buildServer();

await app.listen({ host, port });
console.log(`Feature Flag Control Center API listening at http://${host}:${port}`);
