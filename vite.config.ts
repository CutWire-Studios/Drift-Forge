/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  optimizeDeps: {
    // The wasm is located relative to the module's own URL; pre-bundling moves the module and
    // breaks that lookup.
    exclude: ["@bokuweb/zstd-wasm"],
  },
  server: {
    // `npm run dev:server` runs the Forge server (sign-in, hosted AI, MCP) on :8787.
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
    },
  },
  build: {
    target: "es2022",
  },
  worker: {
    // The default IIFE format rewrites import.meta.url (used by the Emscripten glue) to
    // self.location.href, and AudioWorkletGlobalScope has no `self`.
    format: "es",
  },
  test: {
    environment: "node",
    // server/ runs on Bun (bun:sqlite) and has its own tests: `bun test server`.
    include: ["src/**/*.test.ts"],
  },
})
