import React, { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import {
  CheckSquare, Pencil, Boxes, CalendarDays, Network,
  ChevronRight, ChevronDown, Plus, Download, FilePlus, FolderPlus, Folder,
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
  node_type: "link" | "file" | "note" | "doc" | "folder";
  url: string | null; file_path: string | null;
}

type Panel = "todo" | "whiteboards" | "spaces";

// ── DB setup ───────────────────────────────────────────────────────────────

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
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
    try { await db.execute("ALTER TABLE wb_notes ADD COLUMN width REAL"); } catch { /* exists */ }
    try { await db.execute("ALTER TABLE wb_notes ADD COLUMN height REAL"); } catch { /* exists */ }
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
    await db.execute(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at INTEGER NOT NULL
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
  collapsed: boolean;
  onToggleCollapse: () => void;
  onArxivImport: () => void;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

// ── Component ──────────────────────────────────────────────────────────────

export default function Sidebar({ active, onActivate, onDataChange, collapsed, onToggleCollapse, onArxivImport }: Props) {
  const [activePanel, setActivePanel] = useState<Panel | null>("spaces");
  const [panelWidth, setPanelWidth] = useState(240);
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
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [inlineAdd, setInlineAdd] = useState<{ spaceId: string; type: "file" | "folder"; basePath: string | null; afterNodeId: string | null } | null>(null);
  const spaceInputRef = useRef<HTMLInputElement>(null);
  const inlineAddRef = useRef<HTMLInputElement>(null);

  const resizerRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => { if (addingTodo)  todoInputRef.current?.focus();  }, [addingTodo]);
  useEffect(() => { if (addingBoard) boardInputRef.current?.focus(); }, [addingBoard]);
  useEffect(() => { if (addingSpace) spaceInputRef.current?.focus(); }, [addingSpace]);
  useEffect(() => { if (inlineAdd)   inlineAddRef.current?.focus();  }, [inlineAdd]);

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

    for (const s of rows) {
      if (!s.folder_path) {
        try {
          const fp = await invoke<string>("setup_space_folder", { name: s.name });
          await db.execute("UPDATE spaces SET folder_path = ? WHERE id = ?", [fp, s.id]);
          s.folder_path = fp;
        } catch { /* ignore */ }
      }
    }

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
        setSpaces(await db.select<Space[]>("SELECT id, name, folder_path, created_at FROM spaces ORDER BY created_at ASC"));
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

  // Refresh todos when a sticky note creates one externally
  useEffect(() => {
    const handler = () => loadTodos();
    window.addEventListener("daemon:todos-changed", handler);
    return () => window.removeEventListener("daemon:todos-changed", handler);
  }, []);

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
    const folderPath = spaces.find(s => s.id === id)?.folder_path ?? null;
    const db = await getDb();
    await db.execute("DELETE FROM spaces WHERE id = ?", [id]);
    await db.execute("DELETE FROM space_nodes WHERE space_id = ?", [id]);
    await db.execute("DELETE FROM space_edges WHERE space_id = ?", [id]);
    if (folderPath) {
      try { await invoke("delete_folder", { folderPath }); } catch { /* ignore */ }
    }
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
    if (node.node_type === "doc") { onActivate({ type: "note", noteId: node.id }); return; }
    if (node.node_type === "file" && node.file_path) {
      const fp = node.file_path.toLowerCase();
      if (fp.endsWith(".pdf")) {
        onActivate({ type: "pdf", nodeId: node.id, filePath: node.file_path });
        return;
      }
      const { isTextFile } = await import("../views/TextFileView");
      if (isTextFile(node.file_path)) {
        onActivate({ type: "textfile", filePath: node.file_path });
        return;
      }
      try { await tauriOpenUrl(node.file_path); } catch { /* ignore */ }
      return;
    }
    try {
      if (node.node_type === "link" && node.url) await tauriOpenUrl(node.url);
    } catch { /* ignore */ }
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
    if (n.node_type === "folder") return <Folder size={12} color="#a78bfa" />;
    if (n.node_type === "doc")  return <NotebookPen size={12} color="#22c55e" />;
    if (n.node_type === "link") return <Globe size={12} color="#3b82f6" />;
    if (n.node_type === "note") return <StickyNote size={12} color="#f59e0b" />;
    const ext = (n.file_path ?? n.title).split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return <FileText size={12} color="#ef4444" />;
    if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return <Image size={12} color="#22c55e" />;
    if (["md","txt","csv"].includes(ext)) return <FileCode size={12} color="#3b82f6" />;
    return <File size={12} />;
  }

  // ── Context menus ─────────────────────────────────────────────────────────

  function ctxTodoPanel(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Task", onClick: () => setAddingTodo(true) },
    ]});
  }
  function ctxTodoItem(e: React.MouseEvent, t: Todo) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: t.completed ? "Mark Incomplete" : "Mark Complete", onClick: () => toggleTodo(t.id, t.completed) },
      { label: "Delete", onClick: () => deleteTodo(t.id), danger: true, separator: true },
    ]});
  }
  function ctxBoardPanel(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Board", onClick: () => setAddingBoard(true) },
    ]});
  }
  function ctxBoardItem(e: React.MouseEvent, b: Board) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Delete Board", onClick: () => deleteBoard(b.id), danger: true },
    ]});
  }
  function ctxSpacePanel(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "New Space", onClick: () => setAddingSpace(true) },
      { label: "Import from arXiv…", onClick: onArxivImport, separator: true },
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

  async function commitInlineAdd(rawName: string) {
    if (!inlineAdd) return;
    const { spaceId, type, basePath } = inlineAdd;
    setInlineAdd(null);
    const name = rawName.trim();
    if (!name) return;

    if (type === "file") {
      const fileName = name.includes(".") ? name : `${name}.md`;
      const filePath = basePath ? `${basePath}/${fileName}` : null;
      if (filePath) {
        try { await invoke("write_text_file", { path: filePath, content: "" }); } catch { /* ignore */ }
      }
      const db = await getDb();
      const id = crypto.randomUUID();
      const title = fileName.replace(/\.[^.]+$/, "");
      await db.execute(
        `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, spaceId, title, null, null, filePath, "file", JSON.stringify([]), 0, 0, Date.now()]
      );
      await loadSpaceNodes(spaceId);
      if (filePath) onActivate({ type: "textfile", filePath });
    } else {
      const subPath = basePath ? `${basePath}/${name}` : null;
      if (subPath) {
        try { await invoke("create_folder", { path: subPath }); } catch { /* ignore */ }
      }
      const db = await getDb();
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, spaceId, name, null, null, subPath, "folder", JSON.stringify([]), 0, 0, Date.now()]
      );
      await loadSpaceNodes(spaceId);
      onActivate({ type: "spaces", spaceId });
    }
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
    resizerRef.current = { startX: e.clientX, startW: panelWidth };
    const move = (e: MouseEvent) => {
      if (!resizerRef.current) return;
      setPanelWidth(Math.min(480, Math.max(160, resizerRef.current.startW + e.clientX - resizerRef.current.startX)));
    };
    const up = () => { resizerRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const pendingCount = todos.filter(t => !t.completed).length;

  return (
    <div className={`sidebar-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      {/* ── Activity bar ── */}
      <div className="activity-bar">
        <button
          className={`ab-btn${activePanel === "todo" ? " active" : ""}`}
          title="Todo"
          onClick={() => setActivePanel(p => p === "todo" ? null : "todo")}
        >
          <CheckSquare size={22} />
          {pendingCount > 0 && <span className="ab-dot" />}
        </button>

        <button
          className={`ab-btn${activePanel === "whiteboards" ? " active" : ""}`}
          title="Whiteboards"
          onClick={() => setActivePanel(p => p === "whiteboards" ? null : "whiteboards")}
        >
          <Pencil size={22} />
        </button>

        <button
          className={`ab-btn${activePanel === "spaces" ? " active" : ""}`}
          title="Spaces"
          onClick={() => setActivePanel(p => p === "spaces" ? null : "spaces")}
        >
          <Boxes size={22} />
        </button>

        <button
          className={`ab-btn${active?.type === "calendar" ? " active" : ""}`}
          title="Calendar"
          onClick={() => { onActivate({ type: "calendar" }); setActivePanel(null); }}
        >
          <CalendarDays size={22} />
        </button>

        <button
          className={`ab-btn${active?.type === "global-graph" ? " active" : ""}`}
          title="Global Graph"
          onClick={() => { onActivate({ type: "global-graph" }); setActivePanel(null); }}
        >
          <Network size={22} />
        </button>
      </div>

      {/* ── Explorer panel ── */}
      {activePanel && (
        <aside className="explorer-panel" style={{ width: panelWidth }}>
          <div className="explorer-hdr">
            <span className="explorer-hdr-title">
              {activePanel === "todo" && "TODO"}
              {activePanel === "whiteboards" && "WHITEBOARDS"}
              {activePanel === "spaces" && "SPACES"}
            </span>
            <div className="explorer-hdr-actions">
              {activePanel === "todo" && (
                <button className="explorer-hdr-btn" title="New Task" onClick={() => setAddingTodo(true)}>
                  <Plus size={14} />
                </button>
              )}
              {activePanel === "whiteboards" && (
                <button className="explorer-hdr-btn" title="New Board" onClick={() => setAddingBoard(true)}>
                  <Plus size={14} />
                </button>
              )}
              {activePanel === "spaces" && (
                <>
                  <button className="explorer-hdr-btn explorer-hdr-btn-arxiv" title="Import from arXiv" onClick={onArxivImport}>
                    <Download size={13} />
                    <span>arXiv</span>
                  </button>
                  <button className="explorer-hdr-btn" title="New Space" onClick={() => setAddingSpace(true)}>
                    <Plus size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="explorer-body">

            {/* ── Todo panel ── */}
            {activePanel === "todo" && (
              <div className="explorer-content" onContextMenu={ctxTodoPanel}>
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

            {/* ── Whiteboards panel ── */}
            {activePanel === "whiteboards" && (
              <div className="explorer-content" onContextMenu={ctxBoardPanel}>
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

            {/* ── Spaces panel ── */}
            {activePanel === "spaces" && (
              <div className="explorer-content" onContextMenu={ctxSpacePanel}>
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
                        onMouseEnter={() => setHoveredSpaceId(s.id)}
                        onMouseLeave={() => setHoveredSpaceId(null)}
                      >
                        <span className="sb-tree-chevron">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                        <Boxes size={13} className="sb-tree-icon" />
                        <span className="sb-item-label">{s.name}</span>
                        {hoveredSpaceId === s.id && (
                          <span className="sb-row-actions">
                            <button
                              className="sb-row-btn"
                              title="New File"
                              onClick={e => { e.stopPropagation(); setInlineAdd({ spaceId: s.id, type: "file", basePath: s.folder_path, afterNodeId: null }); if (!expandedSpaces.has(s.id)) toggleSpace(s.id); }}
                            >
                              <FilePlus size={12} />
                            </button>
                            <button
                              className="sb-row-btn"
                              title="New Folder"
                              onClick={e => { e.stopPropagation(); setInlineAdd({ spaceId: s.id, type: "folder", basePath: s.folder_path, afterNodeId: null }); if (!expandedSpaces.has(s.id)) toggleSpace(s.id); }}
                            >
                              <FolderPlus size={12} />
                            </button>
                          </span>
                        )}
                      </div>

                      {expanded && (
                        <ul className="sb-node-list">
                          {nodes.length === 0 && inlineAdd?.spaceId !== s.id
                            ? <li className="sb-empty" style={{ paddingLeft: 40 }}>Empty</li>
                            : nodes.map(n => (
                              <React.Fragment key={n.id}>
                                <li
                                  className={`sb-node-item${n.node_type === "folder" ? " sb-node-folder" : ""}`}
                                  onClick={() => openNode(n)}
                                  onContextMenu={e => ctxNodeRow(e, n)}
                                  onMouseEnter={() => n.node_type === "folder" && setHoveredNodeId(n.id)}
                                  onMouseLeave={() => setHoveredNodeId(null)}
                                >
                                  <span className="sb-node-icon">{nodeIcon(n)}</span>
                                  <span className="sb-item-label">{n.title}</span>
                                  {n.node_type === "folder" && hoveredNodeId === n.id && (
                                    <span className="sb-row-actions">
                                      <button className="sb-row-btn" title="New File"
                                        onClick={e => { e.stopPropagation(); setInlineAdd({ spaceId: s.id, type: "file", basePath: n.file_path, afterNodeId: n.id }); }}>
                                        <FilePlus size={12} />
                                      </button>
                                      <button className="sb-row-btn" title="New Folder"
                                        onClick={e => { e.stopPropagation(); setInlineAdd({ spaceId: s.id, type: "folder", basePath: n.file_path, afterNodeId: n.id }); }}>
                                        <FolderPlus size={12} />
                                      </button>
                                    </span>
                                  )}
                                </li>
                                {inlineAdd?.spaceId === s.id && inlineAdd.afterNodeId === n.id && (
                                  <li className="sb-inline-add" style={{ paddingLeft: 36 }}>
                                    <span className="sb-node-icon">
                                      {inlineAdd.type === "file" ? <FilePlus size={12} /> : <FolderPlus size={12} />}
                                    </span>
                                    <input
                                      ref={inlineAddRef}
                                      className="sb-add-input"
                                      placeholder={inlineAdd.type === "file" ? "filename.md" : "folder name"}
                                      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitInlineAdd(e.currentTarget.value); if (e.key === "Escape") setInlineAdd(null); }}
                                      onBlur={e => commitInlineAdd(e.target.value)}
                                    />
                                  </li>
                                )}
                              </React.Fragment>
                            ))
                          }
                          {inlineAdd?.spaceId === s.id && inlineAdd.afterNodeId === null && (
                            <li className="sb-inline-add" style={{ paddingLeft: 28 }}>
                              <span className="sb-node-icon">
                                {inlineAdd.type === "file" ? <FilePlus size={12} /> : <FolderPlus size={12} />}
                              </span>
                              <input
                                ref={inlineAddRef}
                                className="sb-add-input"
                                placeholder={inlineAdd.type === "file" ? "filename.md" : "folder name"}
                                onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitInlineAdd(e.currentTarget.value); if (e.key === "Escape") setInlineAdd(null); }}
                                onBlur={e => commitInlineAdd(e.target.value)}
                              />
                            </li>
                          )}
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
          <div className="sb-resizer" onMouseDown={onResizerDown} />
        </aside>
      )}

      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}

      {/* ── Collapse toggle ── */}
      <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? "›" : "‹"}
      </button>
    </div>
  );
}
