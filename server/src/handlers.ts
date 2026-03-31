import type { components } from "@zenodotus/api-spec/schema";
import type { FastifyReply, FastifyRequest } from "fastify";
import { assignGroups } from "./providers/claude-code.js";

type GroupRequest = components["schemas"]["GroupRequest"];

export const serviceHandlers = {
  async healthCheck(_req: FastifyRequest, _reply: FastifyReply) {
    return { ok: true };
  },

  async groupTabs(req: FastifyRequest<{ Body: GroupRequest }>, reply: FastifyReply) {
    const result = await assignGroups(req.body);

    if (!result) {
      reply.code(500);
      return { error: "Failed to parse LLM response" };
    }

    return result;
  },
};
