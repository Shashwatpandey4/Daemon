import { useEffect, useRef, useState, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;
import Database from "@tauri-apps/plugin-sql";
import "@excalidraw/excalidraw/index.css";
import WbNoteOverlay from "../components/WbNoteOverlay";
import type { WbNote, WbNoteEdge, WbNoteRef, ScrollState } from "../components/WbNoteOverlay";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";
import type { ActiveView } from "../App";

interface Props {
  boardId: string;
  onNavigate?: (view: ActiveView) => void;
}

const SAVE_DEBOUNCE = 1000;
const NOTE_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa"];

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`CREATE TABLE IF NOT EXISTS wb_note_refs (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      ref_text TEXT NOT NULL
    )`);
  }
  return db;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

/** Parse todo: and wb: lines from note content */
function parseRefs(content: string): { todos: string[]; whiteboards: string[] } {
  const todos: string[] = [];
  const whiteboards: string[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    const todoM = t.match(/^todo\s*:\s*(.+)/i);
    if (todoM) { todos.push(todoM[1].trim()); continue; }
    const wbM = t.match(/^wb\s*:\s*(.+)/i);
    if (wbM) { whiteboards.push(wbM[1].trim()); }
  }
  return { todos, whiteboards };
}

export default function WhiteboardView({ boardId, onNavigate }: Props) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">("");
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [wbNotes, setWbNotes] = useState<WbNote[]>([]);
  const [wbEdges, setWbEdges] = useState<WbNoteEdge[]>([]);
  const [wbRefs, setWbRefs] = useState<WbNoteRef[]>([]);
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

  async function loadRefs() {
    try {
      const db = await getDb();
      const rows = await db.select<WbNoteRef[]>(
        `SELECT r.note_id, r.ref_type, r.ref_id, r.ref_text
         FROM wb_note_refs r
         JOIN wb_notes n ON n.id = r.note_id AND n.whiteboard_id = ?`,
        [boardId]
      );
      setWbRefs(rows);
    } catch { /* table may not exist yet */ }
  }

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
          "SELECT id, content, pos_x, pos_y, color, width, height FROM wb_notes WHERE whiteboard_id = ? ORDER BY created_at ASC",
          [boardId]
        ),
        db.select<WbNoteEdge[]>(
          "SELECT id, source_id, target_id FROM wb_note_edges WHERE whiteboard_id = ?",
          [boardId]
        ),
      ]);
      setWbNotes(notes);
      setWbEdges(edges);
      await loadRefs();
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Cross-reference sync ───────────────────────────────────────────────────

  async function syncNoteRefs(noteId: string, content: string) {
    const db = await getDb();
    // Ensure table exists — guards against stale module singleton in dev mode
    await db.execute(`CREATE TABLE IF NOT EXISTS wb_note_refs (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL,
      ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, ref_text TEXT NOT NULL
    )`);
    const { todos, whiteboards } = parseRefs(content);

    // Get existing refs for this note
    const existingRefs = await db.select<WbNoteRef[]>(
      "SELECT note_id, ref_type, ref_id, ref_text FROM wb_note_refs WHERE note_id = ?",
      [noteId]
    );

    // ── Sync todos ──
    const existingTodos = existingRefs.filter(r => r.ref_type === "todo");
    const newTodoTexts = new Set(todos);
    const oldTodoTexts = new Set(existingTodos.map(r => r.ref_text));

    // Remove todos that were deleted from content
    let todoDeleted = false;
    for (const ref of existingTodos) {
      if (!newTodoTexts.has(ref.ref_text)) {
        await db.execute("DELETE FROM todos WHERE id = ?", [ref.ref_id]);
        await db.execute("DELETE FROM wb_note_refs WHERE note_id = ? AND ref_type = 'todo' AND ref_text = ?", [noteId, ref.ref_text]);
        todoDeleted = true;
      }
    }
    if (todoDeleted) window.dispatchEvent(new CustomEvent("daemon:todos-changed"));

    // Add new todos
    for (const text of todos) {
      if (!oldTodoTexts.has(text)) {
        const todoId = crypto.randomUUID();
        const now = Date.now();
        await db.execute(
          "INSERT INTO todos (id, title, completed, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
          [todoId, text, now, now]
        );
        const refId = crypto.randomUUID();
        await db.execute(
          "INSERT INTO wb_note_refs (id, note_id, ref_type, ref_id, ref_text) VALUES (?, ?, 'todo', ?, ?)",
          [refId, noteId, todoId, text]
        );
        window.dispatchEvent(new CustomEvent("daemon:todos-changed"));
      }
    }

    // ── Sync whiteboards ──
    const existingWbs = existingRefs.filter(r => r.ref_type === "whiteboard");
    const newWbNames = new Set(whiteboards);
    const oldWbNames = new Set(existingWbs.map(r => r.ref_text));

    // Remove wb refs that were removed from content (don't delete the board itself)
    for (const ref of existingWbs) {
      if (!newWbNames.has(ref.ref_text)) {
        await db.execute("DELETE FROM wb_note_refs WHERE note_id = ? AND ref_type = 'whiteboard' AND ref_text = ?", [noteId, ref.ref_text]);
      }
    }

    // Add new wb refs — find or create the whiteboard
    for (const name of whiteboards) {
      if (!oldWbNames.has(name)) {
        // Find existing whiteboard by name
        const existing = await db.select<{ id: string }[]>(
          "SELECT id FROM whiteboards WHERE name = ? LIMIT 1", [name]
        );
        let wbId: string;
        if (existing.length > 0) {
          wbId = existing[0].id;
        } else {
          // Create new whiteboard
          wbId = crypto.randomUUID();
          await db.execute(
            "INSERT INTO whiteboards (id, name, created_at) VALUES (?, ?, ?)",
            [wbId, name, Date.now()]
          );
        }
        const refId = crypto.randomUUID();
        await db.execute(
          "INSERT INTO wb_note_refs (id, note_id, ref_type, ref_id, ref_text) VALUES (?, ?, 'whiteboard', ?, ?)",
          [refId, noteId, wbId, name]
        );
      }
    }

    await loadRefs();
  }

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

  const handleNoteResize = useCallback((id: string, w: number, h: number) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, width: w, height: h } : n));
    const existing = moveTimersRef.current.get(id + "_resize");
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      const db = await getDb();
      await db.execute("UPDATE wb_notes SET width = ?, height = ? WHERE id = ?", [w, h, id]);
      moveTimersRef.current.delete(id + "_resize");
    }, 300);
    moveTimersRef.current.set(id + "_resize", timer);
  }, []);

  const handleNoteEdit = useCallback(async (id: string, content: string) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
    const db = await getDb();
    await db.execute("UPDATE wb_notes SET content = ? WHERE id = ?", [content, id]);
    await syncNoteRefs(id, content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const handleNoteDelete = useCallback(async (id: string) => {
    // Cascade: delete linked todos and refs
    const db = await getDb();
    const refs = await db.select<WbNoteRef[]>(
      "SELECT note_id, ref_type, ref_id, ref_text FROM wb_note_refs WHERE note_id = ?", [id]
    );
    let todosChanged = false;
    for (const ref of refs) {
      if (ref.ref_type === "todo") {
        await db.execute("DELETE FROM todos WHERE id = ?", [ref.ref_id]);
        todosChanged = true;
      }
    }
    await db.execute("DELETE FROM wb_note_refs WHERE note_id = ?", [id]);
    await db.execute("DELETE FROM wb_notes WHERE id = ?", [id]);
    await db.execute("DELETE FROM wb_note_edges WHERE source_id = ? OR target_id = ?", [id, id]);
    setWbNotes(prev => prev.filter(n => n.id !== id));
    setWbEdges(prev => prev.filter(e => e.source_id !== id && e.target_id !== id));
    setWbRefs(prev => prev.filter(r => r.note_id !== id));
    if (todosChanged) window.dispatchEvent(new CustomEvent("daemon:todos-changed"));
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
          refs={wbRefs}
          onMove={handleNoteMove}
          onResize={handleNoteResize}
          onEdit={handleNoteEdit}
          onDelete={handleNoteDelete}
          onConnect={handleNoteConnect}
          onEdgeDelete={handleEdgeDelete}
          onNavigate={onNavigate}
        />
      </div>
      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
