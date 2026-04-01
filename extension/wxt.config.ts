import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Zenodotus",
    description: "Intelligent LLM-powered tab grouping",
    permissions: ["tabs", "tabGroups", "scripting", "storage", "nativeMessaging"],
    host_permissions: ["<all_urls>"],
  },
});
