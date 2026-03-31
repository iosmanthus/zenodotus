import Fastify from "fastify";
import cors from "@fastify/cors";
import openapiGlue from "fastify-openapi-glue";
import { spec } from "@zenodotus/api-spec";
import { serviceHandlers } from "./handlers.js";

const PORT = 18080;

const app = Fastify({ logger: true });

await app.register(cors);

await app.register(openapiGlue, {
  specification: spec,
  serviceHandlers,
});

await app.listen({ port: PORT });
console.log(`Zenodotus server listening on http://localhost:${PORT}`);
