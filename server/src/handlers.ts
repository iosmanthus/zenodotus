import type { components } from "@zenodotus/api-spec/schema";
import type { FastifyReply, FastifyRequest } from "fastify";
import { assignGroups } from "./providers/claude-code";

type GroupRequest = components["schemas"]["GroupRequest"];

export const serviceHandlers = {
  async healthCheck(_req: FastifyRequest, _reply: FastifyReply) {
    return { ok: true };
  },

  async groupTabs(req: FastifyRequest<{ Body: GroupRequest }>, reply: FastifyReply) {
    req.log.info(
      { tabs: req.body.tabs.length, existingGroups: req.body.existingGroups?.length ?? 0 },
      "groupTabs request",
    );

    const result = await assignGroups(req.body);

    if (!result) {
      req.log.error("LLM returned no result");
      reply.code(500);
      return { error: "Failed to parse LLM response" };
    }

    req.log.info({ groups: result.groups }, "groupTabs response");
    return result;
  },
};
