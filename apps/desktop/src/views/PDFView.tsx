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
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#fed7aa"];
const SAVE_DEBOUNCE = 1000;

interface HRect { x: number; y: number; width: number; height: number }

interface PdfHighlight {
  id: string;
  rects: string; // JSON HRect[]
  color: string;
  selected_text: string;
}

interface SelToolbar {
  screenX: number;
  screenY: number;
  rects: HRect[];
  text: string;
}

// Promise-based singleton — avoids races and survives Vite HMR re-runs
let dbPromise: Promise<Awaited<ReturnType<typeof Database.load>>> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await Database.load("sqlite:daemon.db");
      await database.execute(`CREATE TABLE IF NOT EXISTS wb_notes (
        id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
        content TEXT DEFAULT '', pos_x REAL DEFAULT 0, pos_y REAL DEFAULT 0,
        color TEXT DEFAULT '#fef08a', created_at INTEGER
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS wb_note_edges (
        id TEXT PRIMARY KEY, whiteboard_id TEXT NOT NULL,
        source_id TEXT NOT NULL, target_id TEXT NOT NULL
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS pdf_highlights (
        id TEXT PRIMARY KEY, node_id TEXT NOT NULL,
        rects TEXT NOT NULL, color TEXT DEFAULT '#fef08a',
        selected_text TEXT DEFAULT '', created_at INTEGER
      )`);
      return database;
    })();
  }
  return dbPromise;
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
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  const [selToolbar, setSelToolbar] = useState<SelToolbar | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
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
  const selToolbarRef = useRef<HTMLDivElement>(null);
  // Holds the latest context-menu builder so the capture-phase listener (registered once)
  // always sees current state without needing to re-register.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const showCtxRef = useRef<(clientX: number, clientY: number) => void>(() => {});

  // Load PDF bytes via Rust command
  useEffect(() => {
    setPdfUrl(null);
    setPdfError(null);
    invoke<ArrayBuffer>("read_file_bytes", { path: filePath })
      .then(buf => {
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        const blob = new Blob([new Uint8Array(buf)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch(err => setPdfError(String(err)));
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

  // Load annotation data, sticky notes, and highlights
  useEffect(() => {
    if (!apiRef.current) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, apiRef.current]);

  async function loadData() {
    const database = await getDb();
    const [rows, notes, edges, hlRows] = await Promise.all([
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
      database.select<PdfHighlight[]>(
        "SELECT id, rects, color, selected_text FROM pdf_highlights WHERE node_id = ? ORDER BY created_at ASC",
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
    setHighlights(hlRows);
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
      appState: { scrollX: 20, scrollY: 20 - pageYPositions[i] * zoom },
    });
  }

  // ── Sticky note handlers ───────────────────────────────────────────────────

  async function addNote(canvasX: number, canvasY: number, content = "") {
    const database = await getDb();
    const id = crypto.randomUUID();
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    await database.execute(
      "INSERT INTO wb_notes (id, whiteboard_id, content, pos_x, pos_y, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, nodeId, content, canvasX, canvasY, color, Date.now()]
    );
    setWbNotes(prev => [...prev, { id, content, pos_x: canvasX, pos_y: canvasY, color }]);
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

  // ── Highlight handlers ─────────────────────────────────────────────────────

  function onCanvasMouseUp(e: React.MouseEvent) {
    if (!highlightMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) { setSelToolbar(null); return; }

    const clientRects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    if (clientRects.length === 0) { setSelToolbar(null); return; }

    // scrollX/scrollY are relative to the canvas area container, not the viewport
    const areaRect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const s = scrollRef.current;
    const rects: HRect[] = clientRects.map(r => ({
      x: (r.left - areaRect.left - s.scrollX) / s.zoom,
      y: (r.top - areaRect.top - s.scrollY) / s.zoom,
      width: r.width / s.zoom,
      height: r.height / s.zoom,
    }));

    const bounding = range.getBoundingClientRect();
    setSelToolbar({
      screenX: bounding.left + bounding.width / 2,
      screenY: bounding.top,
      rects,
      text,
    });
    e.stopPropagation();
  }

  async function createHighlight(color: string) {
    if (!selToolbar) return;
    const database = await getDb();
    const id = crypto.randomUUID();
    const rectsJson = JSON.stringify(selToolbar.rects);
    await database.execute(
      "INSERT INTO pdf_highlights (id, node_id, rects, color, selected_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, nodeId, rectsJson, color, selToolbar.text, Date.now()]
    );
    setHighlights(prev => [...prev, { id, rects: rectsJson, color, selected_text: selToolbar.text }]);
    window.getSelection()?.removeAllRanges();
    setSelToolbar(null);
  }

  async function deleteHighlight(id: string) {
    setHighlights(prev => prev.filter(h => h.id !== id));
    const database = await getDb();
    await database.execute("DELETE FROM pdf_highlights WHERE id = ?", [id]);
  }

  async function copyToNote() {
    if (!selToolbar) return;
    const r = selToolbar.rects[0];
    await addNote(r.x, r.y + (selToolbar.rects[selToolbar.rects.length - 1].y - r.y) / 2, selToolbar.text);
    window.getSelection()?.removeAllRanges();
    setSelToolbar(null);
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  // Update ref on every render so the capture-phase listener always has fresh state.
  showCtxRef.current = (clientX: number, clientY: number) => {
    const areaRect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const s = scrollRef.current;
    const canvasX = (clientX - areaRect.left - s.scrollX) / s.zoom;
    const canvasY = (clientY - areaRect.top - s.scrollY) / s.zoom;

    const hitHighlight = highlights.find(h => {
      const rects: HRect[] = JSON.parse(h.rects);
      return rects.some(r =>
        canvasX >= r.x && canvasX <= r.x + r.width &&
        canvasY >= r.y && canvasY <= r.y + r.height
      );
    });

    const items: CtxItem[] = [];
    if (hitHighlight) {
      const hlId = hitHighlight.id;
      items.push({ label: "Delete highlight", onClick: () => deleteHighlight(hlId) });
    }
    items.push({ label: "Add Sticky Note", onClick: () => addNote(canvasX, canvasY) });
    setCtx({ x: clientX, y: clientY, items });
  };

  // Capture-phase listener intercepts right-click before Excalidraw can stopPropagation.
  // Registered once on mount; calls through showCtxRef so it always has current state.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxRef.current(e.clientX, e.clientY);
    };
    el.addEventListener("contextmenu", handler, true);
    return () => el.removeEventListener("contextmenu", handler, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PDF layer transform — pages rendered at renderZoom scale, CSS bridges the gap
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
          <button
            className={`pdf-mode-btn ${highlightMode ? "active" : ""}`}
            title={highlightMode ? "Switch to draw mode" : "Switch to highlight mode"}
            onClick={() => { setHighlightMode(m => !m); setSelToolbar(null); window.getSelection()?.removeAllRanges(); }}
          >
            {highlightMode ? "✏ Draw" : "🖊 Highlight"}
          </button>
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
      <div
        className={`pdf-canvas-area${highlightMode ? " pdf-highlight-mode" : ""}`}
        ref={canvasRef}
        onMouseUp={onCanvasMouseUp}
        onMouseDown={() => setSelToolbar(null)}
      >
        {pdfError && (
          <div style={{ position: "absolute", top: 20, left: 20, color: "#ef4444", fontSize: "0.85rem", zIndex: 10 }}>
            Failed to load PDF: {pdfError}
          </div>
        )}

        {/* PDF pages + highlight rects — behind Excalidraw */}
        <div className="pdf-pages-layer" style={pdfLayerStyle}>
          {pdfUrl && <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={null}
            error={<div className="pdf-load-error">Failed to load PDF</div>}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} style={{ marginBottom: PAGE_GAP * renderZoom, position: "relative" }}>
                <Page
                  pageNumber={i + 1}
                  width={PAGE_WIDTH * renderZoom}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                  onLoadSuccess={page => {
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

          {/* Highlight rects — absolutely positioned in render-space coords */}
          <div style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
            {highlights.map(h => {
              const rects: HRect[] = JSON.parse(h.rects);
              return rects.map((r, i) => (
                <div
                  key={`${h.id}-${i}`}
                  style={{
                    position: "absolute",
                    left: r.x * renderZoom,
                    top: r.y * renderZoom,
                    width: r.width * renderZoom,
                    height: r.height * renderZoom,
                    background: h.color,
                    opacity: 0.45,
                    mixBlendMode: "multiply",
                    pointerEvents: "auto",
                    cursor: "default",
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtx({
                      x: e.clientX, y: e.clientY,
                      items: [{ label: "Delete highlight", onClick: () => deleteHighlight(h.id) }],
                    });
                  }}
                />
              ));
            })}
          </div>
        </div>

        {/* Excalidraw + sticky note overlay */}
        <div
          className="pdf-excalidraw-wrap"
          style={highlightMode ? { pointerEvents: "none" } : undefined}
        >
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

        {/* Selection toolbar — fixed screen coords, stops propagation so mousedown doesn't clear it */}
        {selToolbar && (
          <div
            ref={selToolbarRef}
            className="pdf-sel-toolbar"
            style={{ left: selToolbar.screenX, top: selToolbar.screenY }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="pdf-sel-colors">
              {HIGHLIGHT_COLORS.map(color => (
                <button
                  key={color}
                  className="pdf-sel-swatch"
                  style={{ background: color }}
                  title="Highlight"
                  onClick={() => createHighlight(color)}
                />
              ))}
            </div>
            <button className="pdf-sel-copy-btn" onClick={copyToNote}>
              Copy to note
            </button>
          </div>
        )}
      </div>

      {ctx && <>
        <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setCtx(null)} />
        <ContextMenu {...ctx} onClose={() => setCtx(null)} />
      </>}
    </div>
  );
}
