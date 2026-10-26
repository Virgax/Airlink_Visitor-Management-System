import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js resolves `server-only` itself; outside Next the real module throws on import.
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      PASS_SIGNING_KEY: "test-pass-signing-key-0123456789abcdef0123456789abcdef",
      DOC_HASH_KEY: "test-doc-hash-key-0123456789abcdef0123456789abcdef",
      APP_ENCRYPTION_KEY: "test-app-encryption-key-0123456789abcdef0123456789",
      SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
      TEAMS_ACTION_SECRET: "test-teams-action-secret",
      APP_URL: "http://localhost:3000",
      NOTIFY_FAKE: "1",
    },
  },
});
