import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

// The OpenCode SDK client is pure, self-contained TypeScript (no runtime npm
// deps on the client path), so we alias straight to its source instead of
// installing it. This keeps apps/web a standalone package — no root workspace
// edit, no `file:` dep that would drag in the SDK's server-side deps — which
// keeps upstream merges clean.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@opencode-ai/sdk": path.resolve(__dirname, "../../packages/sdk/js/src/client.ts"),
    },
  },
  server: {
    port: 5173,
  },
})
