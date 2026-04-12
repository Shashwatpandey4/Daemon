import { useEffect, useState, useCallback, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { Plus, Trash2, Link2, ChevronRight, ChevronDown, FileText, Image, File, FileCode, Globe, StickyNote } from "lucide-react";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import SpaceGraph from "../components/SpaceGraph";
import AddNodeModal, { type NodeDraft } from "../components/AddNodeModal";

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
  content: string | null;
  url: string | null;
  file_path: string | null;
  node_type: "link" | "file" | "note";
  tags: string | null;   // JSON array string
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
    // Migrate space_nodes to nullable url + file_path + node_type columns.
    // We check the schema and rebuild the table if url is still NOT NULL.
    const tableInfo = await db.select<{ name: string; notnull: number }[]>(
      `PRAGMA table_info(space_nodes)`
    );
    const urlCol = tableInfo.find(c => c.name === "url");
    const needsMigration = !urlCol || urlCol.notnull === 1;

    if (needsMigration && urlCol) {
      // Rebuild: preserve existing rows, relax url constraint, add new cols
      await db.execute(`ALTER TABLE space_nodes RENAME TO space_nodes_old`);
      await db.execute(`
        CREATE TABLE space_nodes (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          url TEXT,
          file_path TEXT,
          node_type TEXT NOT NULL DEFAULT 'note',
          tags TEXT,
          pos_x REAL NOT NULL DEFAULT 100,
          pos_y REAL NOT NULL DEFAULT 100,
          created_at INTEGER NOT NULL
        )
      `);
      await db.execute(`
        INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
        SELECT id, space_id, title, NULL, url, NULL, 'link', NULL, pos_x, pos_y, created_at FROM space_nodes_old
      `);
      await db.execute(`DROP TABLE space_nodes_old`);
    } else if (!urlCol) {
      // Fresh install
      await db.execute(`
        CREATE TABLE IF NOT EXISTS space_nodes (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          url TEXT,
          file_path TEXT,
          node_type TEXT NOT NULL DEFAULT 'note',
          tags TEXT,
          pos_x REAL NOT NULL DEFAULT 100,
          pos_y REAL NOT NULL DEFAULT 100,
          created_at INTEGER NOT NULL
        )
      `);
    }
    // Add any missing columns (idempotent)
    for (const col of ["content TEXT", "file_path TEXT", "node_type TEXT NOT NULL DEFAULT 'note'", "tags TEXT"]) {
      try { await db.execute(`ALTER TABLE space_nodes ADD COLUMN ${col}`); } catch { /* exists */ }
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
  const [showAddNode, setShowAddNode] = useState(false);
  const [panelWidth, setPanelWidth] = useState(220);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "error" | "ok" } | null>(null);
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set());
  const [allSpaceNodes, setAllSpaceNodes] = useState<Record<string, SpaceNode[]>>({});

  function showToast(msg: string, type: "error" | "ok" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

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
    setAllSpaceNodes(prev => ({ ...prev, [spaceId]: n }));
  }

  async function loadPanelNodes(spaceId: string) {
    if (allSpaceNodes[spaceId]) return; // already loaded
    const db = await getDb();
    const n = await db.select<SpaceNode[]>(
      "SELECT * FROM space_nodes WHERE space_id = ? ORDER BY created_at ASC", [spaceId]
    );
    setAllSpaceNodes(prev => ({ ...prev, [spaceId]: n }));
  }

  function toggleExpand(spaceId: string) {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
        loadPanelNodes(spaceId);
      }
      return next;
    });
    setActiveSpace(spaceId);
  }

  function nodeIcon(node: SpaceNode) {
    if (node.node_type === "link") return <Globe size={12} color="#3b82f6" />;
    if (node.node_type === "note") return <StickyNote size={12} color="#f59e0b" />;
    const ext = (node.file_path ?? node.title).split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return <FileText size={12} color="#ef4444" />;
    if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return <Image size={12} color="#22c55e" />;
    if (["md","txt","csv"].includes(ext)) return <FileCode size={12} color="#3b82f6" />;
    return <File size={12} />;
  }

  async function openNode(node: SpaceNode) {
    try {
      if (node.node_type === "link" && node.url) await tauriOpenUrl(node.url);
      else if (node.node_type === "file" && node.file_path) await invoke("open_file", { path: node.file_path });
    } catch (e) { console.error(e); }
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

  async function addNode(draft: NodeDraft) {
    if (!activeSpace) return;
    setShowAddNode(false);
    const db = await getDb();
    const { x, y } = nextNodePos(nodes.length);
    const tagsJson = JSON.stringify(draft.tags);

    // Determine node type
    const isUrl = /^https?:\/\//i.test(draft.content);
    let nodeType: "link" | "file" | "note" = "note";
    let url: string | null = null;
    let filePath: string | null = null;

    if (draft.filePath) {
      try {
        filePath = await invoke<string>("import_file", { spaceId: activeSpace, src: draft.filePath });
        nodeType = "file";
      } catch (err) {
        showToast(`Failed to import file — ${String(err)}`, "error");
        return;
      }
    } else if (isUrl) {
      url = draft.content;
      nodeType = "link";
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, activeSpace, draft.title, draft.content, url, filePath, nodeType, tagsJson, x, y, Date.now()]
    );
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

        <div className="spaces-tree">
          {spaces.map(s => {
            const expanded = expandedSpaces.has(s.id);
            const isActive = s.id === activeSpace;
            const panelNodes = allSpaceNodes[s.id] ?? [];
            return (
              <div key={s.id} className="tree-section">
                {/* Space header row */}
                <div
                  className={`tree-space-row ${isActive ? "active" : ""}`}
                  onClick={() => toggleExpand(s.id)}
                >
                  <span className="tree-chevron">
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <span className="tree-space-name">{s.name}</span>
                  <button
                    className="space-delete"
                    onClick={e => { e.stopPropagation(); deleteSpace(s.id); }}
                    title="Delete space"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Node list */}
                {expanded && (
                  <ul className="tree-node-list">
                    {panelNodes.length === 0 && (
                      <li className="tree-node-empty">Empty space</li>
                    )}
                    {panelNodes.map(node => (
                      <li
                        key={node.id}
                        className="tree-node-item"
                        onClick={() => openNode(node)}
                        title={node.url ?? node.file_path ?? node.title}
                      >
                        <span className="tree-node-icon">{nodeIcon(node)}</span>
                        <span className="tree-node-label">{node.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

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
              <button className="btn-primary icon-btn" onClick={() => setShowAddNode(true)}>
                <Plus size={14} />
                <span>Add Node</span>
              </button>
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

            {showAddNode && (
              <AddNodeModal onAdd={addNode} onClose={() => setShowAddNode(false)} />
            )}
          </>
        )}
      </div>
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
