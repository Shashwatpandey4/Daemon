import { useEffect, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Excalidraw } from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import WbNoteOverlay from "../components/WbNoteOverlay";
import type { WbNote, WbNoteEdge, ScrollState } from "../components/WbNoteOverlay";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker is copied to public/ at build time — served as a static asset
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

const PAGE_WIDTH = 820;
const PAGE_GAP = 20;
const NOTE_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa"];
const SAVE_DEBOUNCE = 1000;

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`CREATE TABLE IF NOT EXISTS wb_notes (
      id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
      content TEXT DEFAULT '', pos_x REAL DEFAULT 0, pos_y REAL DEFAULT 0,
      color TEXT DEFAULT '#fef08a', created_at INTEGER
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS wb_note_edges (
      id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
      source_id TEXT NOT NULL, target_id TEXT NOT NULL
    )`);
  }
  return db;
}

interface Props {
  nodeId: string;
  filePath: string;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

export default function PDFView({ nodeId, filePath }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pageHeights, setPageHeights] = useState<number[]>([]);
  const [scroll, setScroll] = useState<ScrollState>({ scrollX: 20, scrollY: 20, zoom: 1 });
  const [wbNotes, setWbNotes] = useState<WbNote[]>([]);
  const [wbEdges, setWbEdges] = useState<WbNoteEdge[]>([]);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [title, setTitle] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [renderZoom, setRenderZoom] = useState(1);
  const renderZoomRef = useRef(1);
  const renderZoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const scrollRef = useRef<ScrollState>({ scrollX: 20, scrollY: 20, zoom: 1 });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const moveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load PDF bytes via Rust command (bypasses frontend permission scope)
  useEffect(() => {
    setPdfUrl(null);
    setPdfError(null);
    console.log("[PDF] loading from path:", filePath);
    invoke<ArrayBuffer>("read_file_bytes", { path: filePath })
      .then(buf => {
        console.log("[PDF] bytes received, byteLength:", buf?.byteLength);
        // Revoke previous blob URL to avoid memory leaks
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        const blob = new Blob([new Uint8Array(buf)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch(err => {
        console.error("[PDF] read_file_bytes failed:", err);
        setPdfError(String(err));
      });
  }, [filePath]);

  // Cumulative Y positions for each page in canvas space
  const pageYPositions = pageHeights.reduce<number[]>((acc, _h, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + pageHeights[i - 1] + PAGE_GAP);
    return acc;
  }, []);

  // RAF loop — keep scroll state in sync with Excalidraw
  useEffect(() => {
    let raf: number;
    const poll = () => {
      if (apiRef.current) {
        const s = apiRef.current.getAppState();
        const nx = s.scrollX ?? 20, ny = s.scrollY ?? 20, nz = s.zoom?.value ?? 1;
        const cur = scrollRef.current;
        if (nx !== cur.scrollX || ny !== cur.scrollY || nz !== cur.zoom) {
          const next = { scrollX: nx, scrollY: ny, zoom: nz };
          scrollRef.current = next;
          setScroll(next);
          // Re-render PDF pages at new resolution after zoom settles (300ms debounce)
          if (nz !== renderZoomRef.current) {
            if (renderZoomTimerRef.current) clearTimeout(renderZoomTimerRef.current);
            renderZoomTimerRef.current = setTimeout(() => {
              renderZoomRef.current = nz;
              setRenderZoom(nz);
            }, 300);
          }
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Load annotation data + sticky notes
  useEffect(() => {
    if (!apiRef.current) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, apiRef.current]);

  async function loadData() {
    const database = await getDb();
    const [rows, notes, edges] = await Promise.all([
      database.select<{ title: string; content: string | null }[]>(
        "SELECT title, content FROM space_nodes WHERE id = ?", [nodeId]
      ),
      database.select<WbNote[]>(
        "SELECT id, content, pos_x, pos_y, color FROM wb_notes WHERE whiteboard_id = ? ORDER BY created_at ASC",
        [nodeId]
      ),
      database.select<WbNoteEdge[]>(
        "SELECT id, source_id, target_id FROM wb_note_edges WHERE whiteboard_id = ?",
        [nodeId]
      ),
    ]);

    if (rows[0]) {
      setTitle(rows[0].title);
      const content = rows[0].content;
      if (content && apiRef.current) {
        try {
          loadingRef.current = true;
          const parsed = JSON.parse(content);
          apiRef.current.updateScene({
            elements: parsed.elements ?? [],
            appState: {
              ...(parsed.appState ?? {}),
              collaborators: new Map(),
              viewBackgroundColor: "transparent",
            },
          });
          if (parsed.files) apiRef.current.addFiles(Object.values(parsed.files));
        } catch { /* corrupt data — ignore */ }
        setTimeout(() => { loadingRef.current = false; }, 100);
      }
    }

    setWbNotes(notes);
    setWbEdges(edges);
  }

  // Save Excalidraw annotation data to space_nodes.content
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: any, appState: any, files: any) => {
    if (loadingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const data = JSON.stringify({
        elements,
        appState: { ...appState, collaborators: undefined },
        files,
      });
      const database = await getDb();
      await database.execute("UPDATE space_nodes SET content = ? WHERE id = ?", [data, nodeId]);
    }, SAVE_DEBOUNCE);
  }, [nodeId]);

  // Jump Excalidraw scroll to bring page `i` to the top of the canvas
  function scrollToPage(i: number) {
    if (!apiRef.current || pageYPositions.length <= i) return;
    const zoom = scrollRef.current.zoom;
    apiRef.current.updateScene({
      appState: {
        scrollX: 20,
        scrollY: 20 - pageYPositions[i] * zoom,
      },
    });
  }

  // ── Sticky note handlers (mirrors WhiteboardView) ──────────────────────────

  async function addNote(canvasX: number, canvasY: number) {
    const database = await getDb();
    const id = crypto.randomUUID();
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    await database.execute(
      "INSERT INTO wb_notes (id, whiteboard_id, content, pos_x, pos_y, color, created_at) VALUES (?, ?, '', ?, ?, ?, ?)",
      [id, nodeId, canvasX, canvasY, color, Date.now()]
    );
    setWbNotes(prev => [...prev, { id, content: "", pos_x: canvasX, pos_y: canvasY, color }]);
  }

  const handleNoteMove = useCallback(async (id: string, x: number, y: number) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, pos_x: x, pos_y: y } : n));
    const existing = moveTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      const database = await getDb();
      await database.execute("UPDATE wb_notes SET pos_x = ?, pos_y = ? WHERE id = ?", [x, y, id]);
      moveTimersRef.current.delete(id);
    }, 300);
    moveTimersRef.current.set(id, timer);
  }, []);

  const handleNoteEdit = useCallback(async (id: string, content: string) => {
    setWbNotes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
    const database = await getDb();
    await database.execute("UPDATE wb_notes SET content = ? WHERE id = ?", [content, id]);
  }, []);

  const handleNoteDelete = useCallback(async (id: string) => {
    setWbNotes(prev => prev.filter(n => n.id !== id));
    setWbEdges(prev => prev.filter(e => e.source_id !== id && e.target_id !== id));
    const database = await getDb();
    await database.execute("DELETE FROM wb_notes WHERE id = ?", [id]);
    await database.execute("DELETE FROM wb_note_edges WHERE source_id = ? OR target_id = ?", [id, id]);
  }, []);

  const handleNoteConnect = useCallback(async (srcId: string, tgtId: string) => {
    const exists = wbEdges.some(
      e => (e.source_id === srcId && e.target_id === tgtId) ||
           (e.source_id === tgtId && e.target_id === srcId)
    );
    if (exists) return;
    const database = await getDb();
    const id = crypto.randomUUID();
    await database.execute(
      "INSERT INTO wb_note_edges (id, whiteboard_id, source_id, target_id) VALUES (?, ?, ?, ?)",
      [id, nodeId, srcId, tgtId]
    );
    setWbEdges(prev => [...prev, { id, source_id: srcId, target_id: tgtId }]);
  }, [nodeId, wbEdges]);

  const handleEdgeDelete = useCallback(async (id: string) => {
    setWbEdges(prev => prev.filter(e => e.id !== id));
    const database = await getDb();
    await database.execute("DELETE FROM wb_note_edges WHERE id = ?", [id]);
  }, []);

  function onCanvasCtx(e: React.MouseEvent) {
    e.preventDefault();
    const s = scrollRef.current;
    const canvasX = (e.clientX - s.scrollX) / s.zoom;
    const canvasY = (e.clientY - s.scrollY) / s.zoom;
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [{ label: "Add Sticky Note", onClick: () => addNote(canvasX, canvasY) }],
    });
  }

  // Transform that maps canvas-space PDF pages to screen-space.
  // Pages are rendered at PAGE_WIDTH * renderZoom so we scale by zoom/renderZoom.
  // This keeps pages crisp at rest while CSS handles interim zoom transitions.
  const pdfLayerStyle: React.CSSProperties = {
    transform: `translate(${scroll.scrollX}px, ${scroll.scrollY}px) scale(${scroll.zoom / renderZoom})`,
    transformOrigin: "0 0",
  };

  return (
    <div className="pdf-view">

      {/* ── Left: PDF nav panel ── */}
      <div className="pdf-nav-panel">
        <div className="pdf-nav-header">
          <span className="pdf-nav-title" title={title}>{title}</span>
        </div>
        <div className="pdf-nav-thumbs">
          {!pdfUrl && <p className="pdf-nav-loading">Loading…</p>}
          {pdfUrl && <Document file={pdfUrl}>
            {Array.from({ length: numPages }, (_, i) => (
              <button
                key={i}
                className="pdf-nav-thumb-btn"
                onClick={() => scrollToPage(i)}
              >
                <Page
                  pageNumber={i + 1}
                  width={148}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
                <span className="pdf-nav-page-num">{i + 1}</span>
              </button>
            ))}
          </Document>}
        </div>
      </div>

      {/* ── Right: canvas ── */}
      <div className="pdf-canvas-area" ref={canvasRef} onContextMenu={onCanvasCtx}>

        {/* PDF pages — rendered behind Excalidraw in canvas coordinate space */}
        {pdfError && (
          <div style={{ position: "absolute", top: 20, left: 20, color: "#ef4444", fontSize: "0.85rem", zIndex: 10 }}>
            Failed to load PDF: {pdfError}
          </div>
        )}
        <div className="pdf-pages-layer" style={pdfLayerStyle}>
          {pdfUrl && <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={null}
            error={<div className="pdf-load-error">Failed to load PDF</div>}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} style={{ marginBottom: PAGE_GAP * renderZoom }}>
                <Page
                  pageNumber={i + 1}
                  width={PAGE_WIDTH * renderZoom}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={page => {
                    // Store canvas-space heights (zoom=1) for scroll math
                    const h = Math.round(PAGE_WIDTH * (page.originalHeight / page.originalWidth));
                    setPageHeights(prev => {
                      const next = [...prev];
                      next[i] = h;
                      return next;
                    });
                  }}
                />
              </div>
            ))}
          </Document>}
        </div>

        {/* Excalidraw + sticky note overlay */}
        <div className="pdf-excalidraw-wrap">
          <Excalidraw
            excalidrawAPI={api => {
              apiRef.current = api;
              loadData();
            }}
            onChange={onChange}
            theme="dark"
            initialData={{
              appState: {
                viewBackgroundColor: "transparent",
                scrollX: 20,
                scrollY: 20,
              },
            }}
            UIOptions={{
              canvasActions: { export: false, loadScene: false, saveToActiveFile: false },
            }}
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
      </div>

      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
