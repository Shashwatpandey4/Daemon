import { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import {
  CheckSquare, Pencil, Boxes,
  ChevronRight, ChevronDown,
  Globe, FileText, Image, File, FileCode, StickyNote, NotebookPen,
} from "lucide-react";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import ContextMenu, { type CtxItem } from "./ContextMenu";
import type { ActiveView } from "../App";

// ── Types ──────────────────────────────────────────────────────────────────

interface Todo { id: string; title: string; completed: boolean; }
interface Board { id: string; name: string; created_at: number; }
interface Space { id: string; name: string; folder_path: string | null; created_at: number; }
interface SpaceNode {
  id: string; space_id: string; title: string;
  node_type: "link" | "file" | "note" | "doc";
  url: string | null; file_path: string | null;
}

// ── DB setup ───────────────────────────────────────────────────────────────

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    // Ensure all tables exist (sidebar is the first thing rendered)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS whiteboards (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        data TEXT, created_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS wb_notes (
        id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '', pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#fef08a',
        created_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS wb_note_edges (
        id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
        source_id TEXT NOT NULL, target_id TEXT NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, folder_path TEXT, created_at INTEGER NOT NULL
      )
    `);
    // Migration: add folder_path to existing installs
    try { await db.execute("ALTER TABLE spaces ADD COLUMN folder_path TEXT"); } catch { /* already exists */ }
    await db.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled',
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS space_nodes (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL,
        title TEXT NOT NULL, content TEXT, url TEXT, file_path TEXT,
        node_type TEXT NOT NULL DEFAULT 'note',
        tags TEXT, color TEXT,
        pos_x REAL NOT NULL DEFAULT 0, pos_y REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS space_edges (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL,
        source TEXT NOT NULL, target TEXT NOT NULL
      )
    `);
  }
  return db;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  active: ActiveView;
  onActivate: (view: ActiveView) => void;
  onDataChange: () => void;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

// ── Component ──────────────────────────────────────────────────────────────

export default function Sidebar({ active, onActivate, onDataChange }: Props) {
  const [width, setWidth] = useState(240);
  const [sections, setSections] = useState({ todo: true, whiteboards: true, spaces: true });
  const [ctx, setCtx] = useState<CtxState | null>(null);

  // TODO
  const [todos, setTodos] = useState<Todo[]>([]);
  const [addingTodo, setAddingTodo] = useState(false);
  const todoInputRef = useRef<HTMLInputElement>(null);

  // Whiteboards
  const [boards, setBoards] = useState<Board[]>([]);
  const [addingBoard, setAddingBoard] = useState(false);
  const boardInputRef = useRef<HTMLInputElement>(null);

  // Spaces
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set());
  const [spaceNodes, setSpaceNodes] = useState<Record<string, SpaceNode[]>>({});
  const [addingSpace, setAddingSpace] = useState(false);
  const spaceInputRef = useRef<HTMLInputElement>(null);

  const resizerRef = useRef<{ startX: number; startW: number } | null>(null);

  // Auto-focus
  useEffect(() => { if (addingTodo)   todoInputRef.current?.focus();  }, [addingTodo]);
  useEffect(() => { if (addingBoard)  boardInputRef.current?.focus(); }, [addingBoard]);
  useEffect(() => { if (addingSpace)  spaceInputRef.current?.focus(); }, [addingSpace]);

  // ── Loaders ──────────────────────────────────────────────────────────────

  async function loadTodos() {
    const db = await getDb();
    const rows = await db.select<Array<{ id: string; title: string; completed: number }>>(
      "SELECT id, title, completed FROM todos WHERE deleted = 0 ORDER BY created_at ASC"
    );
    setTodos(rows.map(r => ({ id: r.id, title: r.title, completed: !!r.completed })));
  }

  async function loadBoards() {
    const db = await getDb();
    setBoards(await db.select<Board[]>("SELECT id, name, created_at FROM whiteboards ORDER BY created_at ASC"));
  }

  async function loadSpaces() {
    const db = await getDb();
    const rows = await db.select<Space[]>("SELECT id, name, folder_path, created_at FROM spaces ORDER BY created_at ASC");

    // Backfill folders for spaces that predate this feature
    for (const s of rows) {
      if (!s.folder_path) {
        try {
          const fp = await invoke<string>("setup_space_folder", { name: s.name });
          await db.execute("UPDATE spaces SET folder_path = ? WHERE id = ?", [fp, s.id]);
          s.folder_path = fp;
        } catch { /* ignore */ }
      }
    }

    // Auto-create spaces for folders in ~/Daemon/ that aren't in the DB yet
    try {
      const folders = await invoke<string[]>("list_daemon_folders");
      const knownPaths = new Set(rows.map(s => s.folder_path).filter(Boolean));
      let added = false;
      for (const folderPath of folders) {
        if (!knownPaths.has(folderPath)) {
          const name = folderPath.split("/").pop() ?? folderPath;
          const id = crypto.randomUUID();
          await db.execute(
            "INSERT INTO spaces (id, name, folder_path, created_at) VALUES (?, ?, ?, ?)",
            [id, name, folderPath, Date.now()]
          );
          added = true;
        }
      }
      if (added) {
        const updated = await db.select<Space[]>("SELECT id, name, folder_path, created_at FROM spaces ORDER BY created_at ASC");
        setSpaces(updated);
        return;
      }
    } catch { /* ignore */ }

    setSpaces(rows);
  }

  async function loadSpaceNodes(spaceId: string) {
    const db = await getDb();
    const rows = await db.select<SpaceNode[]>(
      "SELECT id, space_id, title, node_type, url, file_path FROM space_nodes WHERE space_id = ? ORDER BY created_at ASC",
      [spaceId]
    );
    setSpaceNodes(prev => ({ ...prev, [spaceId]: rows }));
  }

  useEffect(() => { loadTodos(); loadBoards(); loadSpaces(); }, []);

  // ── TODO ops ─────────────────────────────────────────────────────────────

  async function addTodo(title: string) {
    setAddingTodo(false);
    const t = title.trim();
    if (!t) return;
    const db = await getDb();
    const now = Date.now();
    await db.execute(
      "INSERT INTO todos (id, title, completed, created_at, updated_at, deleted) VALUES (?, ?, 0, ?, ?, 0)",
      [crypto.randomUUID(), t, now, now]
    );
    loadTodos();
  }

  async function toggleTodo(id: string, completed: boolean) {
    const db = await getDb();
    await db.execute("UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?", [completed ? 0 : 1, Date.now(), id]);
    loadTodos();
  }

  async function deleteTodo(id: string) {
    const db = await getDb();
    await db.execute("UPDATE todos SET deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), id]);
    loadTodos();
  }

  // ── Board ops ─────────────────────────────────────────────────────────────

  async function createBoard(name: string) {
    setAddingBoard(false);
    const n = name.trim() || `Board ${boards.length + 1}`;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO whiteboards (id, name, data, created_at) VALUES (?, ?, NULL, ?)", [id, n, Date.now()]);
    await loadBoards();
    onActivate({ type: "whiteboard", boardId: id });
  }

  async function deleteBoard(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM whiteboards WHERE id = ?", [id]);
    await db.execute("DELETE FROM wb_notes WHERE whiteboard_id = ?", [id]);
    await db.execute("DELETE FROM wb_note_edges WHERE whiteboard_id = ?", [id]);
    await loadBoards();
    if (active?.type === "whiteboard" && active.boardId === id) onActivate(null);
  }

  // ── Space ops ─────────────────────────────────────────────────────────────

  async function createSpace(name: string) {
    setAddingSpace(false);
    const n = name.trim();
    if (!n) return;
    const db = await getDb();
    const id = crypto.randomUUID();
    let folderPath: string | null = null;
    try { folderPath = await invoke<string>("setup_space_folder", { name: n }); } catch { /* ignore */ }
    await db.execute("INSERT INTO spaces (id, name, folder_path, created_at) VALUES (?, ?, ?, ?)", [id, n, folderPath, Date.now()]);
    await loadSpaces();
    onActivate({ type: "spaces", spaceId: id });
    setExpandedSpaces(prev => new Set([...prev, id]));
  }

  async function deleteSpace(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM spaces WHERE id = ?", [id]);
    await db.execute("DELETE FROM space_nodes WHERE space_id = ?", [id]);
    await db.execute("DELETE FROM space_edges WHERE space_id = ?", [id]);
    await loadSpaces();
    setSpaceNodes(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (active?.type === "spaces" && active.spaceId === id) onActivate(null);
  }

  async function deleteNode(node: SpaceNode) {
    const db = await getDb();
    await db.execute("DELETE FROM space_nodes WHERE id = ?", [node.id]);
    await db.execute("DELETE FROM space_edges WHERE source = ? OR target = ?", [node.id, node.id]);
    await loadSpaceNodes(node.space_id);
    onDataChange();
  }

  async function openNode(node: SpaceNode) {
    if (node.node_type === "doc") {
      onActivate({ type: "note", noteId: node.id });
      return;
    }
    if (node.node_type === "file" && node.file_path) {
      if (node.file_path.toLowerCase().endsWith(".pdf")) {
        onActivate({ type: "pdf", nodeId: node.id, filePath: node.file_path });
        return;
      }
      try { await tauriOpenUrl(node.file_path); } catch { /* ignore */ }
      return;
    }
    try {
      if (node.node_type === "link" && node.url) await tauriOpenUrl(node.url);
    } catch { /* ignore */ }
  }

  function toggleSection(k: keyof typeof sections) {
    setSections(prev => ({ ...prev, [k]: !prev[k] }));
  }

  function toggleSpace(spaceId: string) {
    const willExpand = !expandedSpaces.has(spaceId);
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      willExpand ? next.add(spaceId) : next.delete(spaceId);
      return next;
    });
    if (willExpand) loadSpaceNodes(spaceId);
  }

  function nodeIcon(n: SpaceNode) {
    if (n.node_type === "doc")  return <NotebookPen size={11} color="#22c55e" />;
    if (n.node_type === "link") return <Globe size={11} color="#3b82f6" />;
    if (n.node_type === "note") return <StickyNote size={11} color="#f59e0b" />;
    const ext = (n.file_path ?? n.title).split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return <FileText size={11} color="#ef4444" />;
    if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return <Image size={11} color="#22c55e" />;
    if (["md","txt","csv"].includes(ext)) return <FileCode size={11} color="#3b82f6" />;
    return <File size={11} />;
  }

  // ── Context menus ─────────────────────────────────────────────────────────

  function ctxTodoSection(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Task", onClick: () => { setSections(s => ({ ...s, todo: true })); setAddingTodo(true); } },
    ]});
  }
  function ctxTodoItem(e: React.MouseEvent, t: Todo) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: t.completed ? "Mark Incomplete" : "Mark Complete", onClick: () => toggleTodo(t.id, t.completed) },
      { label: "Delete", onClick: () => deleteTodo(t.id), danger: true, separator: true },
    ]});
  }
  function ctxBoardSection(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Board", onClick: () => { setSections(s => ({ ...s, whiteboards: true })); setAddingBoard(true); } },
    ]});
  }
  function ctxBoardItem(e: React.MouseEvent, b: Board) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Delete Board", onClick: () => deleteBoard(b.id), danger: true },
    ]});
  }
  function ctxSpaceSection(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Space", onClick: () => { setSections(s => ({ ...s, spaces: true })); setAddingSpace(true); } },
    ]});
  }
  async function createDoc(spaceId: string) {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.execute(
      `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, spaceId, "Untitled", "", null, null, "doc", JSON.stringify([]), 0, 0, now]
    );
    await loadSpaceNodes(spaceId);
    onActivate({ type: "note", noteId: id });
  }

  function ctxSpaceRow(e: React.MouseEvent, s: Space) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Add Node", onClick: () => onActivate({ type: "spaces", spaceId: s.id, openAddNode: true }) },
      { label: "New Doc", onClick: () => createDoc(s.id) },
      { label: "Delete Space", onClick: () => deleteSpace(s.id), danger: true, separator: true },
    ]});
  }
  function ctxNodeRow(e: React.MouseEvent, n: SpaceNode) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Open", onClick: () => openNode(n) },
      { label: "Delete", onClick: () => deleteNode(n), danger: true, separator: true },
    ]});
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  function onResizerDown(e: React.MouseEvent) {
    e.preventDefault();
    resizerRef.current = { startX: e.clientX, startW: width };
    const move = (e: MouseEvent) => {
      if (!resizerRef.current) return;
      setWidth(Math.min(400, Math.max(160, resizerRef.current.startW + e.clientX - resizerRef.current.startX)));
    };
    const up = () => { resizerRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const pendingCount = todos.filter(t => !t.completed).length;

  return (
    <>
      <aside className="sidebar" style={{ width }}>
        <div className="sb-content">

          {/* ─── TODO ─────────────────────────────────────────── */}
          <div className="sb-section">
            <div className="sb-section-hdr" onClick={() => toggleSection("todo")} onContextMenu={ctxTodoSection}>
              <span className="sb-chevron">{sections.todo ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
              <CheckSquare size={12} className="sb-section-icon" />
              <span className="sb-section-title">Todo</span>
              {pendingCount > 0 && <span className="sb-badge">{pendingCount}</span>}
            </div>

            {sections.todo && (
              <div className="sb-section-body" onContextMenu={ctxTodoSection}>
                {todos.map(t => (
                  <label key={t.id} className={`sb-todo-item${t.completed ? " done" : ""}`} onContextMenu={e => ctxTodoItem(e, t)}>
                    <input type="checkbox" checked={t.completed}
                      onChange={() => toggleTodo(t.id, t.completed)}
                      onClick={e => e.stopPropagation()} />
                    <span className="sb-todo-label">{t.title}</span>
                  </label>
                ))}
                {addingTodo && (
                  <div className="sb-inline-add">
                    <input ref={todoInputRef} className="sb-add-input" placeholder="Task name…"
                      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") addTodo(e.currentTarget.value); if (e.key === "Escape") setAddingTodo(false); }}
                      onBlur={e => addTodo(e.target.value)} />
                  </div>
                )}
                {todos.length === 0 && !addingTodo && <p className="sb-empty">Right-click to add a task</p>}
              </div>
            )}
          </div>

          {/* ─── WHITEBOARDS ──────────────────────────────────── */}
          <div className="sb-section">
            <div className="sb-section-hdr" onClick={() => toggleSection("whiteboards")} onContextMenu={ctxBoardSection}>
              <span className="sb-chevron">{sections.whiteboards ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
              <Pencil size={12} className="sb-section-icon" />
              <span className="sb-section-title">Whiteboards</span>
            </div>

            {sections.whiteboards && (
              <div className="sb-section-body" onContextMenu={ctxBoardSection}>
                {boards.map(b => (
                  <div key={b.id}
                    className={`sb-item${active?.type === "whiteboard" && active.boardId === b.id ? " active" : ""}`}
                    onClick={() => onActivate({ type: "whiteboard", boardId: b.id })}
                    onContextMenu={e => ctxBoardItem(e, b)}>
                    <span className="sb-item-label">{b.name}</span>
                  </div>
                ))}
                {addingBoard && (
                  <div className="sb-inline-add">
                    <input ref={boardInputRef} className="sb-add-input" placeholder="Board name…"
                      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") createBoard(e.currentTarget.value); if (e.key === "Escape") setAddingBoard(false); }}
                      onBlur={e => createBoard(e.target.value)} />
                  </div>
                )}
                {boards.length === 0 && !addingBoard && <p className="sb-empty">Right-click to add a board</p>}
              </div>
            )}
          </div>

          {/* ─── SPACES ───────────────────────────────────────── */}
          <div className="sb-section">
            <div className="sb-section-hdr" onClick={() => toggleSection("spaces")} onContextMenu={ctxSpaceSection}>
              <span className="sb-chevron">{sections.spaces ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
              <Boxes size={12} className="sb-section-icon" />
              <span className="sb-section-title">Spaces</span>
            </div>

            {sections.spaces && (
              <div className="sb-section-body" onContextMenu={ctxSpaceSection}>
                {spaces.map(s => {
                  const expanded = expandedSpaces.has(s.id);
                  const nodes = spaceNodes[s.id] ?? [];
                  const isActive = active?.type === "spaces" && active.spaceId === s.id;
                  return (
                    <div key={s.id}>
                      <div
                        className={`sb-tree-row${isActive ? " active" : ""}`}
                        onClick={() => { onActivate({ type: "spaces", spaceId: s.id }); toggleSpace(s.id); }}
                        onContextMenu={e => ctxSpaceRow(e, s)}
                      >
                        <span className="sb-tree-chevron">{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
                        <Boxes size={11} className="sb-tree-icon" />
                        <span className="sb-item-label">{s.name}</span>
                      </div>

                      {expanded && (
                        <ul className="sb-node-list">
                          {nodes.length === 0
                            ? <li className="sb-empty" style={{ paddingLeft: 40 }}>Empty</li>
                            : nodes.map(n => (
                              <li key={n.id} className="sb-node-item"
                                onClick={() => openNode(n)}
                                onContextMenu={e => ctxNodeRow(e, n)}>
                                <span className="sb-node-icon">{nodeIcon(n)}</span>
                                <span className="sb-item-label">{n.title}</span>
                              </li>
                            ))
                          }
                        </ul>
                      )}
                    </div>
                  );
                })}

                {addingSpace && (
                  <div className="sb-inline-add">
                    <input ref={spaceInputRef} className="sb-add-input" placeholder="Space name…"
                      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") createSpace(e.currentTarget.value); if (e.key === "Escape") setAddingSpace(false); }}
                      onBlur={e => createSpace(e.target.value)} />
                  </div>
                )}
                {spaces.length === 0 && !addingSpace && <p className="sb-empty">Right-click to add a space</p>}
              </div>
            )}
          </div>

        </div>
        <div className="sb-resizer" onMouseDown={onResizerDown} />
      </aside>

      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </>
  );
}
