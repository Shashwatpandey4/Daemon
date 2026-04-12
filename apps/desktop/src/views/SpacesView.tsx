import { useEffect, useState, useCallback, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { Plus, Trash2, Link2, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import SpaceGraph from "../components/SpaceGraph";

const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 400;

export interface Space {
  id: string;
  name: string;
  created_at: number;
}

export interface SpaceNode {
  id: string;
  space_id: string;
  title: string;
  url: string | null;
  file_path: string | null;
  node_type: "link" | "file";
  pos_x: number;
  pos_y: number;
  created_at: number;
}

export interface SpaceEdge {
  id: string;
  space_id: string;
  source: string;
  target: string;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS space_nodes (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        file_path TEXT,
        node_type TEXT NOT NULL DEFAULT 'link',
        pos_x REAL NOT NULL DEFAULT 100,
        pos_y REAL NOT NULL DEFAULT 100,
        created_at INTEGER NOT NULL
      )
    `);
    // Migrate: add new columns if this is an existing DB
    for (const col of ["url TEXT", "file_path TEXT", "node_type TEXT NOT NULL DEFAULT 'link'"]) {
      try { await db.execute(`ALTER TABLE space_nodes ADD COLUMN ${col}`); } catch { /* already exists */ }
    }
    await db.execute(`
      CREATE TABLE IF NOT EXISTS space_edges (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL
      )
    `);
  }
  return db;
}

function extractTitle(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function nextNodePos(count: number) {
  return {
    x: 80 + (count % 5) * 240,
    y: 80 + Math.floor(count / 5) * 160,
  };
}

export default function SpacesView() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpace, setActiveSpace] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SpaceNode[]>([]);
  const [edges, setEdges] = useState<SpaceEdge[]>([]);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const linkUrlRef = useRef<HTMLInputElement>(null);
  const [panelWidth, setPanelWidth] = useState(200);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragRef.current.startWidth + delta));
      setPanelWidth(next);
    }

    function onMouseUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  async function loadSpaces() {
    const db = await getDb();
    const rows = await db.select<Space[]>("SELECT * FROM spaces ORDER BY created_at ASC");
    setSpaces(rows);
    if (rows.length > 0 && !activeSpace) setActiveSpace(rows[0].id);
  }

  async function loadGraph(spaceId: string) {
    const db = await getDb();
    const [n, e] = await Promise.all([
      db.select<SpaceNode[]>("SELECT * FROM space_nodes WHERE space_id = ? ORDER BY created_at ASC", [spaceId]),
      db.select<SpaceEdge[]>("SELECT * FROM space_edges WHERE space_id = ?", [spaceId]),
    ]);
    setNodes(n);
    setEdges(e);
  }

  useEffect(() => { loadSpaces(); }, []);
  useEffect(() => { if (activeSpace) loadGraph(activeSpace); }, [activeSpace]);

  async function addSpace() {
    const name = newSpaceName.trim();
    if (!name) return;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)", [id, name, Date.now()]);
    setNewSpaceName("");
    await loadSpaces();
    setActiveSpace(id);
  }

  async function deleteSpace(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM spaces WHERE id = ?", [id]);
    await db.execute("DELETE FROM space_nodes WHERE space_id = ?", [id]);
    await db.execute("DELETE FROM space_edges WHERE space_id = ?", [id]);
    const remaining = spaces.filter(s => s.id !== id);
    setSpaces(remaining);
    setActiveSpace(remaining[0]?.id ?? null);
  }

  function openAddLink() {
    setLinkUrl("");
    setLinkTitle("");
    setShowAddLink(true);
    setTimeout(() => linkUrlRef.current?.focus(), 50);
  }

  async function addLink() {
    const url = linkUrl.trim();
    if (!url || !activeSpace) return;
    const title = linkTitle.trim() || extractTitle(url);
    const db = await getDb();
    const id = crypto.randomUUID();
    const { x, y } = nextNodePos(nodes.length);
    await db.execute(
      "INSERT INTO space_nodes (id, space_id, title, url, file_path, node_type, pos_x, pos_y, created_at) VALUES (?, ?, ?, ?, NULL, 'link', ?, ?, ?)",
      [id, activeSpace, title, url, x, y, Date.now()]
    );
    setLinkUrl("");
    setLinkTitle("");
    setShowAddLink(false);
    loadGraph(activeSpace);
  }

  async function addFile() {
    if (!activeSpace) return;

    const selected = await openDialog({
      multiple: true,
      filters: [
        { name: "Documents", extensions: ["pdf", "md", "txt", "docx", "csv"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];

    const db = await getDb();
    for (let i = 0; i < files.length; i++) {
      const srcPath = files[i];
      try {
        const destPath = await invoke<string>("import_file", { spaceId: activeSpace, src: srcPath });
        const fileName = destPath.split("/").pop() ?? srcPath.split("/").pop() ?? "file";
        const id = crypto.randomUUID();
        const { x, y } = nextNodePos(nodes.length + i);
        await db.execute(
          "INSERT INTO space_nodes (id, space_id, title, url, file_path, node_type, pos_x, pos_y, created_at) VALUES (?, ?, ?, NULL, ?, 'file', ?, ?, ?)",
          [id, activeSpace, fileName, destPath, x, y, Date.now()]
        );
      } catch (err) {
        console.error("import failed", srcPath, err);
      }
    }
    loadGraph(activeSpace);
  }

  const handleNodeMove = useCallback(async (id: string, x: number, y: number) => {
    const db = await getDb();
    await db.execute("UPDATE space_nodes SET pos_x = ?, pos_y = ? WHERE id = ?", [x, y, id]);
  }, []);

  const handleEdgeAdd = useCallback(async (source: string, target: string) => {
    if (!activeSpace) return;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO space_edges (id, space_id, source, target) VALUES (?, ?, ?, ?)",
      [id, activeSpace, source, target]
    );
    setEdges(prev => [...prev, { id, space_id: activeSpace, source, target }]);
  }, [activeSpace]);

  const handleNodeRename = useCallback(async (id: string, title: string) => {
    const db = await getDb();
    await db.execute("UPDATE space_nodes SET title = ? WHERE id = ?", [title, id]);
    setNodes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  }, []);

  const handleNodeDelete = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM space_nodes WHERE id = ?", [id]);
    await db.execute("DELETE FROM space_edges WHERE source = ? OR target = ?", [id, id]);
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
  }, []);

  const active = spaces.find(s => s.id === activeSpace);

  return (
    <div className="spaces-shell">
      {/* Left panel */}
      <div className="spaces-panel" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="spaces-panel-header">
          <span className="spaces-panel-title">Spaces</span>
        </div>

        <ul className="spaces-list">
          {spaces.map(s => (
            <li
              key={s.id}
              className={`space-item ${s.id === activeSpace ? "active" : ""}`}
              onClick={() => setActiveSpace(s.id)}
            >
              <span className="space-dot" />
              <span className="space-name">{s.name}</span>
              <button
                className="space-delete"
                onClick={e => { e.stopPropagation(); deleteSpace(s.id); }}
                title="Delete space"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>

        <div className="spaces-new">
          <input
            className="spaces-new-input"
            placeholder="New space…"
            value={newSpaceName}
            onChange={e => setNewSpaceName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSpace()}
          />
          <button className="spaces-new-btn" onClick={addSpace}>
            <Plus size={13} /> New Space
          </button>
        </div>
      </div>

      {/* Resize divider */}
      <div className="panel-divider" onMouseDown={onDividerMouseDown} />

      {/* Graph canvas */}
      <div className="spaces-graph">
        {!activeSpace ? (
          <div className="placeholder-view">
            <Link2 size={40} strokeWidth={1} />
            <p>Create a space to get started</p>
          </div>
        ) : (
          <>
            <div className="graph-toolbar">
              <span className="graph-title">{active?.name}</span>
              <div className="toolbar-actions">
                <button className="btn-secondary icon-btn" onClick={addFile}>
                  <Upload size={14} />
                  <span>Add file</span>
                </button>
                <button className="btn-primary icon-btn" onClick={openAddLink}>
                  <Plus size={14} />
                  <span>Add link</span>
                </button>
              </div>
            </div>

            <div className="graph-canvas">
              <SpaceGraph
                nodes={nodes}
                edges={edges}
                onNodeMove={handleNodeMove}
                onEdgeAdd={handleEdgeAdd}
                onNodeRename={handleNodeRename}
                onNodeDelete={handleNodeDelete}
              />
            </div>

            {/* Add link modal */}
            {showAddLink && (
              <div className="modal-backdrop" onClick={() => setShowAddLink(false)}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                  <h3 className="modal-title">Add link</h3>
                  <input
                    ref={linkUrlRef}
                    className="modal-input"
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addLink()}
                  />
                  <input
                    className="modal-input"
                    placeholder="Title (optional)"
                    value={linkTitle}
                    onChange={e => setLinkTitle(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addLink()}
                  />
                  <div className="modal-actions">
                    <button className="btn-ghost" onClick={() => setShowAddLink(false)}>Cancel</button>
                    <button className="btn-primary" onClick={addLink}>Add</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
