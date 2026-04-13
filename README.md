# Daemon

A local-first personal productivity and knowledge management app. Built with Tauri (desktop) and Expo (Android), all data lives on your device — no cloud, no accounts.

---

## What it does today

### Sidebar (VS Code-style)
Activity bar (56px) with icons for Todo, Boards, and Spaces. Clicking an icon opens an explorer panel — same pattern as VS Code. Each panel has a `+` header button and a right-click context menu. Panel is resizable.

### Todo
Inline task list. Add tasks via `+` button or right-click. Pending count shown as a dot on the activity bar icon.

### Whiteboards
Full Excalidraw canvas for free-form drawing and diagramming. Multiple boards, auto-saves as you draw.

**Sticky note graph layer** — draggable sticky notes with bezier connections on top of any drawing. Notes persist independently from the drawing.

### Spaces
Knowledge graph view. Each space maps to a `~/Daemon/<name>/` folder.
- **Nodes** — notes, links, docs, or imported files (PDFs, images, docs)
- **Graph canvas** — d3-force directed layout, drag to reposition
- **Connections** — draw edges between nodes, delete inline
- **Node styling** — 12-color palette, color-coded by type
- **Tree view** — sidebar shows spaces → nodes in a collapsible tree

### Note Editor (Docs)
Obsidian-style centered markdown editor (TipTap). Opens when you click a doc node in a space. Auto-saves with 800ms debounce.

### PDF Reader
In-app PDF reading with full annotation support:
- Pages stacked vertically on a canvas with Excalidraw annotation layer on top
- **Text highlighting** — 5 colors, persisted per document
- **Copy to note** — turn any highlight into a sticky note
- **Sticky notes** — same graph layer as whiteboards
- **Zoom-crisp rendering** — pages re-render at display resolution after zoom settles
- **Nav panel** — page thumbnails for jumping to any page
- **Draw / Highlight mode toggle** in the nav panel

### Global Search
`Ctrl+K` opens a search modal across all todos, space nodes, boards, and whiteboard notes.

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Mobile | Expo (React Native) |
| Database | SQLite via `@tauri-apps/plugin-sql` |
| Graph | `@xyflow/react` + `d3-force` |
| Whiteboard | `@excalidraw/excalidraw` |
| Note editor | TipTap + tiptap-markdown |
| PDF | react-pdf (PDF.js) |
| Monorepo | pnpm workspaces |

---

## Running locally

```bash
# Install dependencies
pnpm install

# Desktop (Tauri dev server)
WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  pnpm --filter desktop tauri dev

# Mobile (Expo)
cd apps/mobile && npx expo start
```

**Requirements:** Rust toolchain, Node 18+, pnpm, system WebKit (Linux: `libwebkit2gtk`)

---

## Roadmap

### 1. Backlinks between notes
`[[note name]]` syntax in the editor that auto-creates graph edges. Clicking a backlink navigates to the referenced note. A backlinks panel shows every note that references the current one — builds a real second brain over time.

### 2. Daily notes / Journal
A dedicated section that opens today's note automatically on launch. Quick scratchpad for raw thoughts, learnings, and links throughout the day. Daily notes appear as nodes in the global graph and can be linked to any space.

### 3. Code blocks with syntax highlighting
TipTap `CodeBlockLowlight` extension — proper syntax highlighting for code snippets inside notes. Critical for an engineering workflow: pseudocode, system diagrams, algorithm sketches, config snippets.

### 4. Spaced repetition from highlights
Turn PDF highlights into a review deck. A "Review" mode cycles through highlights using SM-2 scheduling. Track retention over time. Directly useful for grinding through research papers.

### 5. Web / arXiv import
Paste a URL or arXiv ID → auto-fetch title, abstract, and PDF → create a space node and download the paper. Removes friction from paper ingestion and links the PDF to its metadata node in the graph.

### 6. AI chat over notes and PDFs
Wire the Anthropic API into a sidebar chat panel. Ask questions against your highlighted text, get summaries, generate flashcards, surface connections between notes. Context is built from the current document or space. The biggest productivity multiplier for learning.

### 7. Global graph view
A single canvas that renders all spaces and nodes together. Cross-space edges from backlinks and shared tags form naturally. Useful for spotting unexpected connections across your entire knowledge base once it reaches 50+ nodes.

### 8. LAN sync (Desktop ↔ Mobile)
Sync over local WiFi — no cloud. The Rust backend (`sync.rs`) already has the mDNS + WebSocket skeleton. Completing this keeps phone and laptop in sync on the same network.

### 9. Export
- **Spaces** → folder of Markdown files with frontmatter tags
- **Whiteboards** → PNG or PDF
- **Todos** → plain text or CSV

---

## Project structure

```
Daemon/
├── apps/
│   ├── desktop/          # Tauri app
│   │   ├── src/
│   │   │   ├── components/   # Sidebar, SpaceGraph, CircleNode, WbNoteOverlay, ContextMenu, SearchModal
│   │   │   └── views/        # WhiteboardView, SpacesView, NoteView, PDFView
│   │   └── src-tauri/    # Rust backend (commands, sync, capabilities)
│   └── mobile/           # Expo app
└── packages/
    └── shared/           # Shared TypeScript types
```
