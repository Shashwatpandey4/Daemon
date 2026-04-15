import { useState, useCallback, useRef, useEffect } from "react";
import type { ActiveView } from "../App";

export interface WbNoteRef {
  note_id: string;
  ref_type: "todo" | "whiteboard";
  ref_id: string;
  ref_text: string;
}

export interface WbNote {
  id: string;
  content: string;
  pos_x: number;
  pos_y: number;
  color: string;
  width?: number | null;
  height?: number | null;
}

export interface WbNoteEdge {
  id: string;
  source_id: string;
  target_id: string;
}

export interface ScrollState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

interface Props {
  notes: WbNote[];
  edges: WbNoteEdge[];
  scroll: ScrollState;
  refs?: WbNoteRef[];
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onConnect: (src: string, tgt: string) => void;
  onEdgeDelete: (id: string) => void;
  onNavigate?: (view: ActiveView) => void;
}

const NOTE_W = 180;
const NOTE_H = 100;
const NOTE_MIN_W = 120;
const NOTE_MIN_H = 70;

function toScreen(cx: number, cy: number, s: ScrollState) {
  return { x: s.scrollX + cx * s.zoom, y: s.scrollY + cy * s.zoom };
}

function renderContent(
  content: string,
  noteId: string,
  refs: WbNoteRef[],
  onNavigate?: (view: ActiveView) => void,
) {
  if (!content) return <em className="wb-note-placeholder">Double-click to edit…</em>;
  return (
    <>
      {content.split("\n").map((line, i) => {
        const t = line.trim();
        const todoM = t.match(/^todo\s*:\s*(.+)/i);
        if (todoM) {
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#a3e635", padding: "1px 0" }}>
              <span style={{ opacity: 0.8 }}>☐</span>
              <span>{todoM[1]}</span>
            </div>
          );
        }
        const wbM = t.match(/^wb\s*:\s*(.+)/i);
        if (wbM) {
          const name = wbM[1].trim();
          const ref = refs.find(r => r.note_id === noteId && r.ref_type === "whiteboard" && r.ref_text === name);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#93c5fd", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, padding: "1px 0" }}
              onClick={e => {
                e.stopPropagation();
                if (ref) onNavigate?.({ type: "whiteboard", boardId: ref.ref_id });
              }}
            >
              <span style={{ opacity: 0.8 }}>⊞</span>
              <span>{name}</span>
            </div>
          );
        }
        return <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || "\u00A0"}</div>;
      })}
    </>
  );
}

export default function WbNoteOverlay({
  notes, edges, scroll, refs = [], onMove, onResize, onEdit, onDelete, onConnect, onEdgeDelete, onNavigate,
}: Props) {
  const [connectSrc, setConnectSrc] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string; sx: number; sy: number; cx0: number; cy0: number; zoom: number;
  } | null>(null);
  const resizeRef = useRef<{
    id: string; sx: number; sy: number; w0: number; h0: number; zoom: number;
  } | null>(null);

  // Global mouse move/up handles drag and resize
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { id, sx, sy, cx0, cy0, zoom } = dragRef.current;
        onMove(id, cx0 + (e.clientX - sx) / zoom, cy0 + (e.clientY - sy) / zoom);
      }
      if (resizeRef.current) {
        const { id, sx, sy, w0, h0, zoom } = resizeRef.current;
        const newW = Math.max(NOTE_MIN_W, w0 + (e.clientX - sx) / zoom);
        const newH = Math.max(NOTE_MIN_H, h0 + (e.clientY - sy) / zoom);
        onResize(id, newW, newH);
      }
    };
    const onMouseUp = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMove, onResize]);

  const startDrag = useCallback((note: WbNote, e: React.MouseEvent) => {
    if (editingId) return;
    e.stopPropagation(); e.preventDefault();
    dragRef.current = {
      id: note.id, sx: e.clientX, sy: e.clientY,
      cx0: note.pos_x, cy0: note.pos_y, zoom: scroll.zoom,
    };
  }, [editingId, scroll.zoom]);

  const handleNoteClick = useCallback((id: string, e: React.MouseEvent) => {
    if (!connectSrc || connectSrc === id) return;
    e.stopPropagation();
    onConnect(connectSrc, id);
    setConnectSrc(null);
  }, [connectSrc, onConnect]);

  const toggleConnect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectSrc(v => v === id ? null : id);
  }, []);

  return (
    <div
      className="wb-note-overlay"
      tabIndex={-1}
      onKeyDown={e => e.key === "Escape" && setConnectSrc(null)}
    >
      {/* SVG layer for bezier connections */}
      <svg className="wb-note-svg">
        <defs>
          <marker id="wbn-dot" markerWidth="6" markerHeight="6" refX="3" refY="3">
            <circle cx="3" cy="3" r="2" fill="#64748b" />
          </marker>
        </defs>
        {edges.map(edge => {
          const src = notes.find(n => n.id === edge.source_id);
          const tgt = notes.find(n => n.id === edge.target_id);
          if (!src || !tgt) return null;
          const srcW = (src.width ?? NOTE_W), srcH = (src.height ?? NOTE_H);
          const tgtH = (tgt.height ?? NOTE_H);
          const s = toScreen(src.pos_x + srcW, src.pos_y + srcH / 2, scroll);
          const t = toScreen(tgt.pos_x, tgt.pos_y + tgtH / 2, scroll);
          const cx = (s.x + t.x) / 2;
          const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
          return (
            <g key={edge.id} className="wb-edge-group">
              <path
                d={`M${s.x},${s.y} C${cx},${s.y} ${cx},${t.y} ${t.x},${t.y}`}
                className="wb-edge-path"
                markerEnd="url(#wbn-dot)"
              />
              {/* Wider invisible hit area */}
              <path
                d={`M${s.x},${s.y} C${cx},${s.y} ${cx},${t.y} ${t.x},${t.y}`}
                stroke="transparent"
                strokeWidth={12}
                fill="none"
                style={{ cursor: "pointer" }}
                onClick={() => onEdgeDelete(edge.id)}
              />
              {/* Delete badge at midpoint */}
              <g
                className="wb-edge-delete"
                style={{ cursor: "pointer" }}
                onClick={() => onEdgeDelete(edge.id)}
              >
                <circle cx={mid.x} cy={mid.y} r={8} className="wb-edge-delete-bg" />
                <text
                  x={mid.x} y={mid.y + 4.5}
                  textAnchor="middle"
                  className="wb-edge-delete-x"
                >×</text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Note cards */}
      {notes.map(note => {
        const { x, y } = toScreen(note.pos_x, note.pos_y, scroll);
        const isSrc = connectSrc === note.id;
        const isTarget = !!connectSrc && connectSrc !== note.id;
        const isEditing = editingId === note.id;
        const noteW = (note.width ?? NOTE_W) * scroll.zoom;
        const noteH = (note.height ?? NOTE_H) * scroll.zoom;
        return (
          <div
            key={note.id}
            className="wb-note-wrapper"
            style={{ left: x, top: y, width: noteW }}
          >
            <div
              className={`wb-note${isSrc ? " wb-note-src" : ""}${isTarget ? " wb-note-target" : ""}`}
              style={{ "--note-color": note.color, width: noteW, height: noteH } as React.CSSProperties}
              onMouseDown={e => !isEditing && startDrag(note, e)}
              onClick={e => handleNoteClick(note.id, e)}
              onDoubleClick={e => { e.stopPropagation(); setEditingId(note.id); }}
            >
              {/* Color strip */}
              <div className="wb-note-strip" />

              {/* Action buttons */}
              <div className="wb-note-actions" onMouseDown={e => e.stopPropagation()}>
                <button
                  className={`wb-note-btn${isSrc ? " active" : ""}`}
                  title="Connect to another note"
                  onClick={e => toggleConnect(note.id, e)}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <circle cx="2" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="10" cy="2" r="1.8" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="10" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M3.5 5.5 L8.5 2.5M3.5 6.5 L8.5 9.5" stroke="currentColor" strokeWidth="1.1"/>
                  </svg>
                </button>
                <button
                  className="wb-note-btn danger"
                  title="Delete note"
                  onClick={e => { e.stopPropagation(); onDelete(note.id); }}
                >×</button>
              </div>

              {/* Content */}
              {isEditing ? (
                <textarea
                  className="wb-note-textarea"
                  defaultValue={note.content}
                  autoFocus
                  onMouseDown={e => e.stopPropagation()}
                  onBlur={e => { onEdit(note.id, e.target.value); setEditingId(null); }}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                      onEdit(note.id, e.currentTarget.value);
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <div className="wb-note-text">
                  {renderContent(note.content, note.id, refs, onNavigate)}
                </div>
              )}

              {/* Resize handle — bottom-right corner */}
              <div
                className="wb-note-resize"
                onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  resizeRef.current = {
                    id: note.id, sx: e.clientX, sy: e.clientY,
                    w0: note.width ?? NOTE_W, h0: note.height ?? NOTE_H,
                    zoom: scroll.zoom,
                  };
                }}
              />
            </div>

            {/* Right-side connection handle */}
            <div
              className={`wb-note-handle${isSrc ? " active" : ""}${isTarget ? " target" : ""}`}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setConnectSrc(v => v === note.id ? null : note.id); }}
              title="Drag to connect"
            />
          </div>
        );
      })}

      {/* Connect-mode hint */}
      {connectSrc && (
        <div className="wb-connect-hint">
          Click another note to connect · Esc to cancel
        </div>
      )}
    </div>
  );
}
