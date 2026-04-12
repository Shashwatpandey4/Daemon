# Daemon — Desktop

Tauri v2 + React 19 + TypeScript desktop app. See the [root README](../../README.md) for full project details.

## Dev

```bash
pnpm --filter desktop tauri dev
```

## Build

```bash
pnpm --filter desktop tauri build
```

Output: `src-tauri/target/release/bundle/` (`.deb`, `.AppImage` on Linux)
