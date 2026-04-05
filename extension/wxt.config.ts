import { defineConfig } from "wxt";

export default defineConfig({
  zip: {
    artifactTemplate: "zenodotus-extension.zip",
  },
  manifest: {
    name: "Zenodotus",
    description: "Intelligent LLM-powered tab grouping",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApmFXSFDEKj6lNWD2DbiwmDmVUzt+PEMbdGCqx0gTh3hKZ1zgeHbNu+yMElBVWrmbwy13yaJ+uQSLGukc6t0LAJ8TJI8lfHN4osfjsZ3fnCJlHDQTFiJrlL5mcv0B9+euuatB5U/juD5kbRdbcOLuEGRTgQpV7KE079HaBHLxmsWcyGGh26c0t5t7l0yFGvNhCZs2D1uDO5vVu7TW+Mqso1Cq3MzexpJ7F5D1I9R1kXhJVnAtzimy/gXISOFwPf9Zvkk3db4VIGJbL/9I80Hcdaa33rXY6Sfqs1glvJLltK2xQuQK9KhDcyax8DwxvMkdUAIlOdCh3E8prGwBVjh+uwIDAQAB",
    permissions: ["tabs", "tabGroups", "scripting", "storage", "nativeMessaging"],
    host_permissions: ["<all_urls>"],
  },
});
