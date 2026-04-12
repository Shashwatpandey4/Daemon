import { useEffect, useRef, useState, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;
import Database from "@tauri-apps/plugin-sql";
import "@excalidraw/excalidraw/index.css";
import WbNoteOverlay from "../components/WbNoteOverlay";
import type { WbNote, WbNoteEdge, ScrollState } from "../components/WbNoteOverlay";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";

interface Props {
  boardId: string;
}

const SAVE_DEBOUNCE = 1000;
const NOTE_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa"];

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

export default function WhiteboardView({ boardId }: Props) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">("");
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [wbNotes, setWbNotes] = useState<WbNote[]>([]);
  const [wbEdges, setWbEdges] = useState<WbNoteEdge[]>([]);
  const [scroll, setScroll] = useState<ScrollState>({ scrollX: 0, scrollY: 0, zoom: 1 });

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const scrollRef = useRef<ScrollState>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const moveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const saveStatusRef = useRef<"" | "saving" | "saved">("");

  // RAF loop for smooth note overlay sync
  useEffect(() => {
    let raf: number;
    const poll = () => {
      if (apiRef.current) {
        const s = apiRef.current.getAppState();
        const nx = s.scrollX ?? 0, ny = s.scrollY ?? 0, nz = s.zoom?.value ?? 1;
        const cur = scrollRef.current;
        if (nx !== cur.scrollX || ny !== cur.scrollY || nz !== cur.zoom) {
          const next = { scrollX: nx, scrollY: ny, zoom: nz };
          scrollRef.current = next;
          setScroll(next);
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Load board drawing data + notes when boardId changes
  useEffect(() => {
    async function load() {
      const db = await getDb();
      const rows = await db.select<{ data: string | null }[]>(
        "SELECT data FROM whiteboards WHERE id = ?", [boardId]
      );
      const board = rows[0];
      if (!board) return;

      loadingRef.current = true;
      if (board.data && apiRef.current) {
        try {
          const parsed = JSON.parse(board.data);
          apiRef.current.updateScene({
            elements: parsed.elements ?? [],
            appState: { ...(parsed.appState ?? {}), collaborators: new Map() },
          });
          if (parsed.files) apiRef.current.addFiles(Object.values(parsed.files));
        } catch { apiRef.current?.resetScene(); }
      } else {
        apiRef.current?.resetScene();
      }
      setTimeout(() => { loadingRef.current = false; }, 100);

      // Load notes
      const [notes, edges] = await Promise.all([
        db.select<WbNote[]>(
          "SELECT id, content, pos_x, pos_y, color FROM wb_notes WHERE whiteboard_id = ? ORDER BY created_at ASC",
          [boardId]
        ),
        db.select<WbNoteEdge[]>(
          "SELECT id, source_id, target_id FROM wb_note_edges WHERE whiteboard_id = ?",
          [boardId]
        ),
      ]);
      setWbNotes(notes);
      setWbEdges(edges);
    }
    load();
  }, [boardId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: any, appState: any, files: any) => {
    if (loadingRef.current) return;
    if (saveStatusRef.current !== "saving") { saveStatusRef.current = "saving"; setSaveStatus("saving"); }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const data = JSON.stringify({ elements, appState: { ...appState, collaborators: undefined }, files });
      const db = await getDb();
      await db.execute("UPDATE whiteboards SET data = ? WHERE id = ?", [data, boardId]);
      saveStatusRef.current = "saved";
      setSaveStatus("saved");
      setTimeout(() => { saveStatusRef.current = ""; setSaveStatus(""); }, 2000);
    }, SAVE_DEBOUNCE);
  }, [boardId]);

  // ── Note handlers ──────────────────────────────────────────────────────────

  async function addNote() {
    const db = await getDb();
    const id = crypto.randomUUID();
    const s = scrollRef.current;
    let cx = 0, cy = 0;
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      cx = (rect.width / 2 - s.scrollX) / s.zoom - 90;
      cy = (rect.height / 2 - s.scrollY) / s.zoom - 45;
    }
    cx += (Math.random() - 0.5) * 60;
    cy += (Math.random() - 0.5) * 60;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    await db.execute(
      "INSERT INTO wb_notes (id, whiteboard_id, content, pos_x, pos_y, color, created_at) VALUES (?, ?, '', ?, ?, ?, ?)",
      [id, boardId, cx, cy, color, Date.now()]
    );
    setWbNotes(prev => [...prev, { id, content: "", pos_x: cx, pos_y: cy, color }]);
  }

  const handleNoteMove = useCallback((id: string, x: number, y: number) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, pos_x: x, pos_y: y } : n));
    const existing = moveTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      const db = await getDb();
      await db.execute("UPDATE wb_notes SET pos_x = ?, pos_y = ? WHERE id = ?", [x, y, id]);
      moveTimersRef.current.delete(id);
    }, 300);
    moveTimersRef.current.set(id, timer);
  }, []);

  const handleNoteEdit = useCallback(async (id: string, content: string) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
    const db = await getDb();
    await db.execute("UPDATE wb_notes SET content = ? WHERE id = ?", [content, id]);
  }, []);

  const handleNoteDelete = useCallback(async (id: string) => {
    setWbNotes(prev => prev.filter(n => n.id !== id));
    setWbEdges(prev => prev.filter(e => e.source_id !== id && e.target_id !== id));
    const db = await getDb();
    await db.execute("DELETE FROM wb_notes WHERE id = ?", [id]);
    await db.execute("DELETE FROM wb_note_edges WHERE source_id = ? OR target_id = ?", [id, id]);
  }, []);

  const handleNoteConnect = useCallback(async (srcId: string, tgtId: string) => {
    const exists = wbEdges.some(
      e => (e.source_id === srcId && e.target_id === tgtId) ||
           (e.source_id === tgtId && e.target_id === srcId)
    );
    if (exists) return;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO wb_note_edges (id, whiteboard_id, source_id, target_id) VALUES (?, ?, ?, ?)",
      [id, boardId, srcId, tgtId]
    );
    setWbEdges(prev => [...prev, { id, source_id: srcId, target_id: tgtId }]);
  }, [boardId, wbEdges]);

  const handleEdgeDelete = useCallback(async (id: string) => {
    setWbEdges(prev => prev.filter(e => e.id !== id));
    const db = await getDb();
    await db.execute("DELETE FROM wb_note_edges WHERE id = ?", [id]);
  }, []);

  function onCanvasCtx(e: React.MouseEvent) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, items: [{ label: "Add Sticky Note", onClick: addNote }] });
  }

  return (
    <div className="wb-view">
      {saveStatus && (
        <div className="wb-save-badge">
          <span className={`save-status ${saveStatus}`}>{saveStatus === "saving" ? "Saving…" : "Saved"}</span>
        </div>
      )}
      <div className="wb-excalidraw" ref={canvasRef} onContextMenu={onCanvasCtx}>
        <Excalidraw
          excalidrawAPI={api => { apiRef.current = api; }}
          onChange={onChange}
          theme="dark"
          UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
        />
        <WbNoteOverlay
          notes={wbNotes}
          edges={wbEdges}
          scroll={scroll}
          onMove={handleNoteMove}
          onEdit={handleNoteEdit}
          onDelete={handleNoteDelete}
          onConnect={handleNoteConnect}
          onEdgeDelete={handleEdgeDelete}
        />
      </div>
      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
