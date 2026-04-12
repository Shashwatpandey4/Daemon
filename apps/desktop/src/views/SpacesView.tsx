import { useEffect, useState, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { basename, extname } from "@tauri-apps/api/path";

import SpaceGraph from "../components/SpaceGraph";
import AddNodeModal, { type NodeDraft } from "../components/AddNodeModal";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";

export interface SpaceNode {
  id: string; space_id: string; title: string;
  content: string | null; url: string | null; file_path: string | null;
  node_type: "link" | "file" | "note" | "doc";
  tags: string | null; color: string | null;
  pos_x: number; pos_y: number; created_at: number;
}

export interface SpaceEdge {
  id: string; space_id: string; source: string; target: string;
}

interface Props {
  spaceId: string;
  refreshKey: number;
  openAddNode: boolean;
  onAddNodeClose: () => void;
  onNodeOpen: (nodeId: string) => void;
  onFileOpen: (nodeId: string, filePath: string) => void;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

function nextNodePos(count: number) {
  return { x: 80 + (count % 5) * 240, y: 80 + Math.floor(count / 5) * 160 };
}

interface CtxState { x: number; y: number; items: CtxItem[] }

export default function SpacesView({ spaceId, refreshKey, openAddNode, onAddNodeClose, onNodeOpen, onFileOpen }: Props) {
  const [nodes, setNodes] = useState<SpaceNode[]>([]);
  const [edges, setEdges] = useState<SpaceEdge[]>([]);
  const [showAddNode, setShowAddNode] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "error" | "ok" } | null>(null);

  function showToast(msg: string, type: "error" | "ok" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadGraph() {
    const db = await getDb();
    const [n, e, spaceRows] = await Promise.all([
      db.select<SpaceNode[]>("SELECT * FROM space_nodes WHERE space_id = ? ORDER BY created_at ASC", [spaceId]),
      db.select<SpaceEdge[]>("SELECT * FROM space_edges WHERE space_id = ?", [spaceId]),
      db.select<{ folder_path: string | null }[]>("SELECT folder_path FROM spaces WHERE id = ?", [spaceId]),
    ]);

    const folderPath = spaceRows[0]?.folder_path;
    if (folderPath) {
      try {
        const files = await invoke<string[]>("scan_space_folder", { folderPath });
        const knownPaths = new Set(n.map(node => node.file_path).filter(Boolean));
        const newFiles = files.filter(f => !knownPaths.has(f));
        let insertCount = 0;
        for (const filePath of newFiles) {
          const fileName = await basename(filePath);
          const ext = await extname(filePath);
          const title = fileName.replace(new RegExp(`\\.${ext}$`, "i"), "") || fileName;
          const id = crypto.randomUUID();
          const { x, y } = nextNodePos(n.length + insertCount);
          await db.execute(
            `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, spaceId, title, null, null, filePath, "file", JSON.stringify([]), x, y, Date.now()]
          );
          insertCount++;
        }
        if (insertCount > 0) {
          const [n2, e2] = await Promise.all([
            db.select<SpaceNode[]>("SELECT * FROM space_nodes WHERE space_id = ? ORDER BY created_at ASC", [spaceId]),
            db.select<SpaceEdge[]>("SELECT * FROM space_edges WHERE space_id = ?", [spaceId]),
          ]);
          setNodes(n2);
          setEdges(e2);
          return;
        }
      } catch { /* folder scan failed, fall through */ }
    }

    setNodes(n);
    setEdges(e);
  }

  useEffect(() => { loadGraph(); }, [spaceId, refreshKey]);

  // Trigger AddNodeModal when parent requests it
  useEffect(() => { if (openAddNode) setShowAddNode(true); }, [openAddNode]);

  async function addNode(draft: NodeDraft) {
    setShowAddNode(false);
    onAddNodeClose();
    const db = await getDb();
    const { x, y } = nextNodePos(nodes.length);
    const isUrl = /^https?:\/\//i.test(draft.content);
    let nodeType: "link" | "file" | "note" = "note";
    let url: string | null = null, filePath: string | null = null;
    if (draft.filePath) {
      try {
        filePath = await invoke<string>("import_file", { spaceId, src: draft.filePath });
        nodeType = "file";
      } catch (err) { showToast(`Failed to import file — ${String(err)}`, "error"); return; }
    } else if (isUrl) {
      url = draft.content; nodeType = "link";
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, spaceId, draft.title, draft.content, url, filePath, nodeType, JSON.stringify(draft.tags), x, y, Date.now()]
    );
    loadGraph();
  }

  const handleNodeMove = useCallback(async (id: string, x: number, y: number) => {
    const db = await getDb();
    await db.execute("UPDATE space_nodes SET pos_x = ?, pos_y = ? WHERE id = ?", [x, y, id]);
  }, []);

  const handleEdgeAdd = useCallback(async (source: string, target: string) => {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO space_edges (id, space_id, source, target) VALUES (?, ?, ?, ?)",
      [id, spaceId, source, target]
    );
    setEdges(prev => [...prev, { id, space_id: spaceId, source, target }]);
  }, [spaceId]);

  const handleNodeRename = useCallback(async (id: string, title: string) => {
    const db = await getDb();
    await db.execute("UPDATE space_nodes SET title = ? WHERE id = ?", [title, id]);
    setNodes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  }, []);

  const handleColorChange = useCallback(async (id: string, color: string) => {
    const db = await getDb();
    await db.execute("UPDATE space_nodes SET color = ? WHERE id = ?", [color, id]);
    setNodes(prev => prev.map(n => n.id === id ? { ...n, color } : n));
  }, []);

  const handleEdgeDelete = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM space_edges WHERE id = ?", [id]);
    setEdges(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleNodeDelete = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM space_nodes WHERE id = ?", [id]);
    await db.execute("DELETE FROM space_edges WHERE source = ? OR target = ?", [id, id]);
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
  }, []);

  async function createDoc() {
    const db = await getDb();
    const id = crypto.randomUUID();
    const { x, y } = nextNodePos(nodes.length);
    await db.execute(
      `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, spaceId, "Untitled", "", null, null, "doc", JSON.stringify([]), x, y, Date.now()]
    );
    await loadGraph();
    onNodeOpen(id);
  }

  function onCanvasCtx(e: React.MouseEvent) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Add Node", onClick: () => setShowAddNode(true) },
      { label: "New Doc", onClick: createDoc },
    ]});
  }

  return (
    <div className="graph-canvas" onContextMenu={onCanvasCtx}>
      <SpaceGraph
        nodes={nodes}
        edges={edges}
        onNodeMove={handleNodeMove}
        onEdgeAdd={handleEdgeAdd}
        onEdgeDelete={handleEdgeDelete}
        onNodeRename={handleNodeRename}
        onNodeDelete={handleNodeDelete}
        onColorChange={handleColorChange}
        onNodeOpen={onNodeOpen}
        onFileOpen={onFileOpen}
      />
      {showAddNode && (
        <AddNodeModal
          onAdd={addNode}
          onClose={() => { setShowAddNode(false); onAddNodeClose(); }}
        />
      )}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
