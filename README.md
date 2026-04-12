# Daemon

A local-first personal productivity and knowledge management app. Built with Tauri (desktop) and Expo (Android), all data lives on your device — no cloud, no accounts.

---

## What it does today

### Sidebar (VS Code-style Explorer)
A single resizable sidebar with three collapsible sections. Right-click anywhere for context menus — no toolbar buttons cluttering the UI.

### Todo
Inline task list in the sidebar. Right-click to add, complete, or delete tasks. Persisted locally in SQLite.

### Whiteboards
Full Excalidraw canvas for free-form drawing and diagramming. Supports multiple boards, auto-saves as you draw.

**Sticky note graph layer** — on top of any drawing you can place sticky notes, connect them to each other with bezier lines, and build a mini knowledge graph over your diagram. Notes are draggable, editable, and persisted independently from the drawing.

### Spaces
Knowledge graph view. Each space is a folder-like container. Inside it:
- **Nodes** — notes, links, or imported files (PDFs, images, docs)
- **Graph canvas** — d3-force directed layout, auto-arranges nodes, drag to reposition
- **Connections** — draw edges between any two nodes; delete edges inline
- **Node styling** — 12-color palette per node, color-coded by type or tag
- **VS Code tree** — sidebar shows spaces → nodes in a nested collapsible tree

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Mobile | Expo (React Native) |
| Database | SQLite via `@tauri-apps/plugin-sql` (desktop) / `expo-sqlite` (mobile) |
| Graph | `@xyflow/react` + `d3-force` |
| Whiteboard | `@excalidraw/excalidraw` |
| Monorepo | pnpm workspaces |

---

## Running locally

```bash
# Install dependencies
pnpm install

# Desktop (Tauri dev server)
pnpm --filter desktop tauri dev

# Mobile (Expo)
cd apps/mobile && npx expo start
```

**Requirements:** Rust toolchain, Node 18+, pnpm, system WebKit (Linux: `libwebkit2gtk`)

---

## Roadmap

### 1. Global Search
`Ctrl+K` quick-search across everything — todos, space nodes, whiteboard notes, board names. Results open the relevant item directly in the main canvas.

### 2. AI Integration
- Summarize a space or whiteboard in one click
- Auto-suggest connections between nodes ("these two notes seem related")
- Auto-tag nodes based on content
- Chat interface: "what did I write about X?" queries across all your notes

### 3. Markdown Note Editor
A full-screen rich markdown editor as a fourth sidebar section. Clicking a note node in a space opens it as a proper editor in the main area — not just a text field in the graph. Supports headings, code blocks, tables, and inline images.

### 4. LAN Sync (Desktop ↔ Mobile)
Sync over your local WiFi network — no cloud involved. The Rust backend (`sync.rs`) already has the skeleton. Completing this lets your phone and laptop stay in sync automatically when on the same network.

### 5. Due Dates + Calendar View
Add optional due dates to todos. A calendar view in the main area shows tasks on their due dates, lets you drag-reschedule, and highlights overdue items. Integrates with the existing todo section in the sidebar.

### 6. Global Graph View
A "big picture" canvas that renders all spaces and their nodes together in one force-directed graph. Edges can span across spaces. Useful for spotting unexpected connections across your entire knowledge base.

### 7. Export
- **Spaces** → export as a folder of Markdown files (one file per node, with frontmatter tags)
- **Whiteboards** → export as PNG or PDF
- **Todos** → export as plain text or CSV

### 8. Paper Reader
A dedicated PDF reading experience built inside Spaces. Opening a PDF node splits the main area: PDF reader on the left, knowledge graph on the right.

- Highlight any text in the PDF → automatically creates a linked sticky note node in the graph
- Annotate directly on the PDF with drawings (uses the whiteboard layer)
- Connect highlights to concept nodes, other papers, or external links
- Multiple papers in one space build a comparison graph automatically
- Page references are preserved on each node so you can jump back to the source

---

## Project structure

```
Daemon/
├── apps/
│   ├── desktop/          # Tauri app
│   │   ├── src/          # React frontend
│   │   │   ├── components/   # Sidebar, SpaceGraph, CircleNode, WbNoteOverlay, ContextMenu…
│   │   │   └── views/        # WhiteboardView, SpacesView, TodoView
│   │   └── src-tauri/    # Rust backend (commands, sync, capabilities)
│   └── mobile/           # Expo app
└── packages/
    └── shared/           # Shared TypeScript types
```
