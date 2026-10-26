import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      PASS_SIGNING_KEY: "test-pass-signing-key-0123456789abcdef0123456789abcdef",
      DOC_HASH_KEY: "test-doc-hash-key-0123456789abcdef0123456789abcdef",
      APP_ENCRYPTION_KEY: "test-app-encryption-key-0123456789abcdef0123456789",
    },
  },
});
