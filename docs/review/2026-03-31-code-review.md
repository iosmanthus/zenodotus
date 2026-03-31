# Code Review — 2026-03-31

Cold-start review by Claude Opus 4.6 with zero prior context.

## Critical

- [x] **C1. JSON extraction has no try/catch** — Fixed: replaced regex extraction with MCP tool calling (`assign_tab_groups`). Zod schema validates structured output. No more `JSON.parse` on free text.

- [x] **C2. OpenAPI spec missing error responses** — Fixed: added `ErrorResponse` schema and 400/500 responses to `/group` endpoint.

## Important

- [x] **I1. `autoGroupEnabled` lost on service worker restart** — Fixed: persisted to `chrome.storage.local`. Read/write on every access.

- [x] **I2. Non-null assertions on `tab.id`** — Fixed: replaced with guard clauses, `collectTabInfo` returns `null` for tabs without IDs, callers filter nulls.

- [x] **I3. Popup hardcodes server URL** — Fixed: uses `checkHealth()` from `@/utils/api`.

- [x] **I4. `spec as any` cast** — Fixed: removed along with the regex extraction. MCP tool uses Zod schema directly, no spec access needed in provider.

## Suggestions

- [x] **S1. Restore tool/function calling** — Fixed: MCP tool `assign_tab_groups` with Zod schema via `createSdkMcpServer`.

- [x] **S2. Add debounce for auto-grouping** — Fixed: 2-second batch window collects pending tabs, sends one request.

- [x] **S3. Server-side LLM call has no timeout** — Fixed: 30s `AbortController` timeout on `query()`.

- [x] **S4. No tests** — Fixed: vitest added, `colorForGroup` tests (valid color, determinism, empty string).

- [x] **S5. No linter/formatter** — Fixed: Biome configured with recommended rules, 2-space indent, 100 line width. All files formatted.

- [x] **S6. Generated files tracked in git** — Won't fix: keeping in git is intentional. Clone-and-go, no build step needed, and diffs show spec changes visibly in PRs.

- [x] **S7. OpenAPI ID fields should be `integer`** — Fixed: `tabId`, `windowId`, `groupId` and array items changed to `type: integer`.

- [x] **S8. Popup shows no error feedback** — Fixed: added red error text element, displays `response.error` on failure, auto-clears after 5s.

- [x] **S9. No concurrency guard on manual organize** — Won't fix: the button is already disabled during organize (`organizeBtn.disabled = true`), preventing double-click. Auto + manual concurrency is an edge case acceptable for v1.

- [x] **S10. No server-side LLM request timeout** — Duplicate of S3, merged.
