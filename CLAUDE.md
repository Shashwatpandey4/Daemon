# Daemon — Claude Code Guide

## What this is
Local-first personal productivity and knowledge management app. **No cloud, no accounts.** All data lives in SQLite on the user's device.

## Monorepo layout
```
apps/desktop/        — Tauri v2 (Rust) + React 19 + Vite (TypeScript)
apps/mobile/         — Expo SDK 54 (Android, React Native + TypeScript)
packages/shared/     — shared TypeScript types (@daemon/shared)
```

## Run commands
```bash
# Desktop
cd apps/desktop && WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 pnpm tauri dev

# Mobile
cd apps/mobile && pnpm start
```

## What's built
- **Sidebar** — VS Code-style, three collapsible sections, right-click context menus (no toolbar buttons)
- **Todos** — inline task list, SQLite-persisted, right-click to add/complete/delete
- **Whiteboards** — Excalidraw canvas, multi-board, auto-save; sticky note graph layer (draggable notes + bezier connections) rendered on top
- **Spaces** — `@xyflow/react` + `d3-force` knowledge graph; nodes (notes/links/files), edges, 12-color palette, sidebar tree view

## Key conventions
- Right-click context menus over toolbar/button UI — keep the canvas clean
- SQLite for all persistence (desktop: `@tauri-apps/plugin-sql`, mobile: `expo-sqlite`)
- Shared types live in `packages/shared`, imported as `@daemon/shared`
- Never suggest cloud storage or third-party sync services

## Known gotchas
- **Blank window on Linux** — always run tauri dev with `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`
- **React version pin** — `react` and `react-dom` must be pinned to the exact same version in `apps/desktop/package.json` (pnpm monorepo can hoist them differently)
- **Stale Vite dep cache** — after package version changes, delete `apps/desktop/node_modules/.vite` and do a full restart
- **SQL plugin permissions** — `sql:default` is not enough; need explicit `sql:allow-execute`, `sql:allow-select`, `sql:allow-load` in Tauri capabilities
- **Devtools** — open programmatically in debug builds via `use tauri::Manager` + `app.get_webview_window("main")`
- **Excalidraw** — pre-bundle in `optimizeDeps` to prevent OOM kills during dev startup

## Roadmap (not yet built)
1. Global search — `Ctrl+K` across todos, nodes, whiteboard notes
2. AI integration — summarize, auto-suggest connections, chat queries
3. Markdown note editor — full-screen rich editor, fourth sidebar section
4. LAN sync — Rust skeleton exists in `src-tauri/src/sync.rs`, mDNS + WebSocket
5. Due dates + calendar view
6. Global graph view — all spaces in one force-directed canvas
7. Export — Markdown, PNG/PDF, CSV
8. PDF reader — split view with highlight-to-node linking
