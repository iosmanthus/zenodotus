# Code Review — 2026-03-31

Cold-start review by Claude Opus 4.6 with zero prior context.

## Critical

- [ ] **C1. JSON extraction has no try/catch** — `server/src/providers/claude-code.ts` line 58. `JSON.parse` on a regex match from LLM output will throw unhandled if the match is not valid JSON. Fastify catches it as 500, but the error is unhelpful and unlogged.

- [ ] **C2. OpenAPI spec missing error responses** — `packages/api-spec/openapi.yaml` only defines 200 responses. Server returns `{ error: string }` for 400/500 but this shape is undocumented. Add error response schemas.

## Important

- [ ] **I1. `autoGroupEnabled` lost on service worker restart** — `extension/entrypoints/background.ts` line 10. MV3 service workers are ephemeral. State should be persisted to `chrome.storage.local`.

- [ ] **I2. Non-null assertions on `tab.id`** — `extension/entrypoints/background.ts` lines 28-30. Use guard clauses instead of `!` operator.

- [ ] **I3. Popup hardcodes server URL** — `extension/entrypoints/popup/main.ts` line 20 duplicates `http://localhost:18080/health` instead of importing `checkHealth()` from `@/utils/api`.

- [ ] **I4. `spec as any` cast** — `server/src/providers/claude-code.ts` line 21. Type the import properly instead of bypassing TypeScript.

## Suggestions

- [ ] **S1. Restore tool/function calling** — Original design spec proposed `assign_tab_groups` tool. Implementation downgraded to regex-based JSON extraction, which is less reliable. Tool use should be preferred if the Claude Agent SDK supports it.

- [ ] **S2. Add debounce for auto-grouping** — Rapidly opening tabs fires concurrent LLM requests with no serialization. Add a queue or debounce mechanism.

- [ ] **S3. Server-side LLM call has no timeout** — Extension has 30s `AbortSignal.timeout`, but the server-side `query()` call can hang indefinitely.

- [ ] **S4. No tests** — Zero test files. At minimum: `colorForGroup` (pure function), server handlers (Fastify `inject()`), JSON extraction.

- [ ] **S5. No linter/formatter** — No ESLint, Biome, or Prettier configuration. Important for monorepo consistency.

- [ ] **S6. Generated files tracked in git** — `packages/api-spec/generated/` should be in `.gitignore`. Run `pnpm generate` as a build step instead.

- [ ] **S7. OpenAPI ID fields should be `integer`** — `tabId`, `windowId`, `groupId` use `type: number`. `type: integer` is more semantically correct and enables integer validation.

- [ ] **S8. Popup shows no error feedback** — If organize fails, the button re-enables silently. Should show error state.

- [ ] **S9. No concurrency guard on manual organize** — Clicking "Organize Tabs" twice fires two concurrent requests.

- [ ] **S10. No server-side LLM request timeout** — `query()` options should include a timeout or `AbortController`.
