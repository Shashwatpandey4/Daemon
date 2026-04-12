import { useState, useCallback, useRef, useEffect } from "react";

export interface WbNote {
  id: string;
  content: string;
  pos_x: number;
  pos_y: number;
  color: string;
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
  onMove: (id: string, x: number, y: number) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onConnect: (src: string, tgt: string) => void;
  onEdgeDelete: (id: string) => void;
}

const NOTE_W = 180;
const NOTE_H = 90; // used for bezier midpoint approximation

function toScreen(cx: number, cy: number, s: ScrollState) {
  return { x: s.scrollX + cx * s.zoom, y: s.scrollY + cy * s.zoom };
}

export default function WbNoteOverlay({
  notes, edges, scroll, onMove, onEdit, onDelete, onConnect, onEdgeDelete,
}: Props) {
  const [connectSrc, setConnectSrc] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string; sx: number; sy: number; cx0: number; cy0: number; zoom: number;
  } | null>(null);

  // Global mouse move/up handles drag; registered once, acts only when dragRef is set
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { id, sx, sy, cx0, cy0, zoom } = dragRef.current;
      onMove(id, cx0 + (e.clientX - sx) / zoom, cy0 + (e.clientY - sy) / zoom);
    };
    const onMouseUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMove]);

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
          const s = toScreen(src.pos_x + NOTE_W, src.pos_y + NOTE_H / 2, scroll);
          const t = toScreen(tgt.pos_x, tgt.pos_y + NOTE_H / 2, scroll);
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
        return (
          <div
            key={note.id}
            className="wb-note-wrapper"
            style={{ left: x, top: y }}
          >
            <div
              className={`wb-note${isSrc ? " wb-note-src" : ""}${isTarget ? " wb-note-target" : ""}`}
              style={{ "--note-color": note.color } as React.CSSProperties}
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
                <p className="wb-note-text">
                  {note.content || <em className="wb-note-placeholder">Double-click to edit…</em>}
                </p>
              )}
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
