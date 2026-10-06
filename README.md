# Drift Forge

Build video effects, transitions and audio effects for [CutWire Drift](https://cutwire.org/drift) in the browser, and install them in Drift.

**Use it at [forge.cutwire.org](https://forge.cutwire.org).**

- **Effects and transitions** are node graphs: wire blocks together (colour, distort, blur & light, 3D, patterns, mix & mask, animate, math, custom GLSL) and watch a live WebGL preview on sample clips or your own. Forge compiles the graph to the GLSL shaders Drift runs.
- **Audio effects** are pedalboards built from Drift's own DSP pedals, with splits, modulators (LFO, envelope, steps) and knobs routed to sliders. The preview runs Drift's DSP compiled to WebAssembly, so what you hear is what Drift plays.
- **Sliders** become parameters in Drift's inspector, so people can tune each clip.
- **Starters** for dozens of effects and transitions, plus some audio boards, to start from.
- **Export** a `.driftfx` package or a zip to install in Drift, or share a link that opens the document in Forge.

Everything is saved in your browser; there is no account needed to build and export.

## AI

The AI panel builds and edits documents from a prompt, using the same edit operations as the editor, so every change can be undone like any other. Choose a provider in AI settings:

| Provider | Needs |
| --- | --- |
| CutWire AI | Signing in with a CutWire account (free, daily quota) |
| Anthropic | Your API key |
| OpenAI | Your API key and a model |
| Other / local | Any OpenAI-compatible server URL and model (e.g. a local one) |

Your own keys are stored in your browser and sent only to the provider you picked.

### MCP

Forge is also an MCP server at `/mcp`, so Claude, Cursor or any MCP-capable app can build an effect and hand you a link to open it in Forge.

```sh
claude mcp add --transport http drift-forge https://forge.cutwire.org/mcp
```

For other apps (`mcp.json`):

```json
{ "mcpServers": { "drift-forge": { "url": "https://forge.cutwire.org/mcp" } } }
```

## Development

Requires Node 24 and [Bun](https://bun.sh) (the server and its tests run on Bun).

```sh
npm install
npm run dev          # the app on http://localhost:5173
npm run dev:server   # optional: sign-in, hosted AI and MCP on :8787 (proxied by the dev server)
```

`dev:server` sets `FORGE_DEV=1`, which lets it start without production secrets; sign-in and hosted AI fail with a clear message until they're configured (see `server/config.ts`).

| Script | Does |
| --- | --- |
| `npm run build` | Typecheck and build the app into `dist/` |
| `npm run typecheck` | Typecheck the app and the server |
| `npm run lint` | oxlint with the architecture rules below |
| `npm test` | Vitest for the app, then `bun test` for the server |
| `npm run check-shaders` | Compile every block in every configuration and check the GLSL |

### Tests that guard output

- `src/__tests__/snapshot.test.ts` snapshots everything each starter turns into: preview and export shaders, manifests, package files and audio graphs. A refactor must not change them; if one fails, the change altered what Drift receives.
- `src/__tests__/audio-golden.test.ts` runs the wasm DSP against output rendered by native Drift, so the preview keeps sounding like Drift.
- `check-shaders` catches GLSL a block can only produce in some configurations.

## Architecture

```
src/
  core/        pure logic, no DOM; shared with the server
    doc/         document types, parameter types (PARAM_TYPES), kinds (KIND_INFO)
    edit/        every edit to a document (the editor, the AI and MCP all use these)
    nodes/       the block catalogue: each block emits GLSL
    compiler/    graph → shader passes, validation, Drift manifests
    audio/       pedal catalogue, pedalboard edits, audio graph JSON
    export/      .driftfx, zip and share links
    starters/    built-in starting points
    ai/          the agent loop, tool registry and model providers
  services/    browser-only: WebGL preview engine, audio worklet, IndexedDB, account
  state/       the editor store (zustand + undo)
  features/    UI slices: home, editor, graph, inspector, preview, export, ai-chat, audio-board, code
  shared/      UI building blocks used by several features
  app/         entry point and routes
server/        Bun + Hono: sign-in, hosted AI, MCP
```

Dependencies only point down, and `npm run lint` enforces this:

- `core` imports only `core`. The server imports only `core`.
- `services` don't import UI (`state`, `features`, `shared/ui`, `app`).
- `state` and `shared` don't import features.
- A feature imports another only through its `index.ts` (`@/features/graph`, not `@/features/graph/NodeView`).
- No import cycles.

What differs between cases lives in one table rather than in branches spread across files: `PARAM_TYPES` for parameter types, `KIND_INFO` for effect/transition/audio, the tool registry (zod schemas) for AI and MCP tools, and pedal capabilities for special pedals. To add a parameter type, a document kind or a tool, start from its table. Lint also bans nested ternaries and caps function complexity and file length.

More detail:

- [`docs/driftfx-format.md`](docs/driftfx-format.md): the `.driftfx` package format and audio graph packages.
- [`docs/drift-next-params.md`](docs/drift-next-params.md): parameters and features only the next Drift reads.

## License

[GPL-3.0](LICENSE)
