# Code Review — 2026-03-31

Cold-start review by Claude Opus 4.6 with zero prior context.

## Critical

- [x] **C1. JSON extraction has no try/catch** — Fixed: replaced regex extraction with MCP tool calling (`assign_tab_groups`). Zod schema validates structured output. No more `JSON.parse` on free text.

- [x] **C2. OpenAPI spec missing error responses** — Fixed: added `ErrorResponse` schema and 400/500 responses to `/group` endpoint.

## Important

- [ ] **I1. `autoGroupEnabled` lost on service worker restart** — `extension/entrypoints/background.ts`. MV3 service workers are ephemeral. State should be persisted to `chrome.storage.local`.

- [ ] **I2. Non-null assertions on `tab.id`** — `extension/entrypoints/background.ts`. Use guard clauses instead of `!` operator.

- [ ] **I3. Popup hardcodes server URL** — `extension/entrypoints/popup/main.ts` duplicates `http://localhost:18080/health` instead of importing `checkHealth()` from `@/utils/api`.

- [x] **I4. `spec as any` cast** — Fixed: removed along with the regex extraction. MCP tool uses Zod schema directly, no spec access needed in provider.

## Suggestions

- [x] **S1. Restore tool/function calling** — Fixed: MCP tool `assign_tab_groups` with Zod schema via `createSdkMcpServer`.

- [ ] **S2. Add debounce for auto-grouping** — Rapidly opening tabs fires concurrent LLM requests with no serialization. Add a queue or debounce mechanism.

- [ ] **S3. Server-side LLM call has no timeout** — Extension has 30s `AbortSignal.timeout`, but the server-side `query()` call can hang indefinitely.

- [ ] **S4. No tests** — Zero test files. At minimum: `colorForGroup` (pure function), server handlers (Fastify `inject()`).

- [ ] **S5. No linter/formatter** — No ESLint, Biome, or Prettier configuration. Important for monorepo consistency.

- [x] **S6. Generated files tracked in git** — Won't fix: keeping in git is intentional. Clone-and-go, no build step needed, and diffs show spec changes visibly in PRs.

- [x] **S7. OpenAPI ID fields should be `integer`** — Fixed: `tabId`, `windowId`, `groupId` and array items changed to `type: integer`.

- [ ] **S8. Popup shows no error feedback** — If organize fails, the button re-enables silently. Should show error state.

- [x] **S9. No concurrency guard on manual organize** — Won't fix: the button is already disabled during organize (`organizeBtn.disabled = true`), preventing double-click. Auto + manual concurrency is an edge case acceptable for v1.

- [x] **S10. No server-side LLM request timeout** — Duplicate of S3, merged.
