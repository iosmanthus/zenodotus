import cors from "@fastify/cors";
import { spec } from "@zenodotus/api-spec";
import Fastify from "fastify";
import openapiGlue from "fastify-openapi-glue";
import { serviceHandlers } from "./handlers";

const PORT = Number(process.env.PORT || 18080);

const app = Fastify({ logger: true });

await app.register(cors);

await app.register(openapiGlue, {
  specification: spec,
  serviceHandlers,
});

await app.listen({ port: PORT });
console.log(`Zenodotus server listening on http://localhost:${PORT}`);
