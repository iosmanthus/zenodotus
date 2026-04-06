// Stub WXT globals for vitest
// biome-ignore lint/suspicious/noExplicitAny: WXT global stubs for testing
(globalThis as any).defineBackground = (fn: () => void) => fn;
