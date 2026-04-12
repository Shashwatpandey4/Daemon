import { useEffect, useRef, useState, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;
import Database from "@tauri-apps/plugin-sql";
import { Plus, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import "@excalidraw/excalidraw/index.css";

interface Whiteboard {
  id: string;
  name: string;
  data: string | null;
  created_at: number;
}

const MIN_W = 160;
const MAX_W = 380;
const SAVE_DEBOUNCE = 1000;

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS whiteboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  }
  return db;
}

export default function WhiteboardView() {
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [panelWidth, setPanelWidth] = useState(200);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">("");
  const [expanded, setExpanded] = useState(true);

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const loadingRef = useRef(false);

  activeIdRef.current = activeId;

  async function loadBoards() {
    const db = await getDb();
    const rows = await db.select<Whiteboard[]>("SELECT * FROM whiteboards ORDER BY created_at ASC");
    setBoards(rows);
    if (rows.length > 0 && !activeId) setActiveId(rows[0].id);
  }

  useEffect(() => { loadBoards(); }, []);

  // When active board changes, load its data into Excalidraw
  useEffect(() => {
    if (!activeId || !apiRef.current) return;
    const board = boards.find(b => b.id === activeId);
    if (!board) return;

    loadingRef.current = true;
    if (board.data) {
      try {
        const parsed = JSON.parse(board.data);
        apiRef.current.updateScene({
          elements: parsed.elements ?? [],
          appState: { ...(parsed.appState ?? {}), collaborators: new Map() },
        });
        if (parsed.files) apiRef.current.addFiles(Object.values(parsed.files));
      } catch { apiRef.current.resetScene(); }
    } else {
      apiRef.current.resetScene();
    }
    setTimeout(() => { loadingRef.current = false; }, 100);
  }, [activeId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: any, appState: any, files: any) => {
    if (loadingRef.current) return;
    const id = activeIdRef.current;
    if (!id) return;

    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const data = JSON.stringify({ elements, appState: { ...appState, collaborators: undefined }, files });
      const db = await getDb();
      await db.execute("UPDATE whiteboards SET data = ? WHERE id = ?", [data, id]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    }, SAVE_DEBOUNCE);
  }, []);

  async function addBoard() {
    const name = newName.trim() || `Board ${boards.length + 1}`;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO whiteboards (id, name, data, created_at) VALUES (?, ?, NULL, ?)", [id, name, Date.now()]);
    setNewName("");
    await loadBoards();
    setActiveId(id);
  }

  async function deleteBoard(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM whiteboards WHERE id = ?", [id]);
    const rest = boards.filter(b => b.id !== id);
    setBoards(rest);
    setActiveId(rest[0]?.id ?? null);
  }

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPanelWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.startW + e.clientX - dragRef.current.startX)));
    };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const active = boards.find(b => b.id === activeId);

  return (
    <div className="wb-shell">
      {/* Left panel */}
      <div className="wb-panel" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="wb-panel-header">
          <button className="tree-space-row" style={{ width: "100%", background: "none", border: "none", padding: "10px 8px" }}
            onClick={() => setExpanded(v => !v)}>
            <span className="tree-chevron">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <span className="spaces-panel-title">Whiteboards</span>
          </button>
        </div>

        {expanded && (
          <ul className="spaces-list" style={{ listStyle: "none", padding: "4px 6px", flex: 1, overflowY: "auto" }}>
            {boards.map(b => (
              <li
                key={b.id}
                className={`space-item ${b.id === activeId ? "active" : ""}`}
                onClick={() => setActiveId(b.id)}
              >
                <span className="space-dot" />
                <span className="space-name">{b.name}</span>
                <button className="space-delete" onClick={e => { e.stopPropagation(); deleteBoard(b.id); }}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="spaces-new">
          <input
            className="spaces-new-input"
            placeholder="New board…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addBoard()}
          />
          <button className="spaces-new-btn" onClick={addBoard}>
            <Plus size={13} /> New Board
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="panel-divider" onMouseDown={onDividerMouseDown} />

      {/* Canvas */}
      <div className="wb-canvas">
        {!activeId ? (
          <div className="placeholder-view">
            <p>Create a whiteboard to get started</p>
          </div>
        ) : (
          <>
            <div className="graph-toolbar">
              <span className="graph-title">{active?.name}</span>
              {saveStatus === "saving" && <span className="save-status saving">Saving…</span>}
              {saveStatus === "saved" && <span className="save-status saved">Saved</span>}
            </div>
            <div className="wb-excalidraw">
              <Excalidraw
                excalidrawAPI={api => { apiRef.current = api; }}
                onChange={onChange}
                theme="dark"
                UIOptions={{
                  canvasActions: { export: false, loadScene: false, saveToActiveFile: false },
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
