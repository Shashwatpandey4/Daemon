import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import {
  Plus, Type, Hash, List, Calendar, Link, ExternalLink, ChevronDown,
} from "lucide-react";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ColType = "text" | "number" | "select" | "date" | "url";

export interface SelectOption { label: string; color: string; }

interface TableColumn {
  id: string; table_id: string; name: string;
  col_type: ColType; options: SelectOption[]; position: number;
}
interface RawColumn {
  id: string; table_id: string; name: string;
  col_type: string; options: string; position: number;
}
interface TableRow { id: string; table_id: string; position: number; created_at: number; }
interface RawCell  { row_id: string; col_id: string; value: string; }
type CellMap = Record<string, string>;

interface CtxState { x: number; y: number; items: CtxItem[] }

const SELECT_COLORS = [
  "#7c6fcd","#22c55e","#f59e0b","#ef4444",
  "#3b82f6","#ec4899","#14b8a6","#f97316",
];

const DEFAULT_COL_W = 160;
const DEFAULT_ROW_H = 34;

// ── DB ────────────────────────────────────────────────────────────────────────

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

// ── Column type icon ──────────────────────────────────────────────────────────

function ColIcon({ type }: { type: ColType }) {
  const s = 11;
  if (type === "number")  return <Hash     size={s} />;
  if (type === "select")  return <List     size={s} />;
  if (type === "date")    return <Calendar size={s} />;
  if (type === "url")     return <Link     size={s} />;
  return <Type size={s} />;
}

// ── Select pill ───────────────────────────────────────────────────────────────

function SelectPill({ label, color }: { label: string; color: string }) {
  return (
    <span className="tbl-select-pill" style={{
      background: `color-mix(in srgb, ${color} 22%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    }}>
      {label}
    </span>
  );
}

// ── Add column modal (portal, viewport-aware) ─────────────────────────────────

interface AddColProps {
  anchorRect: DOMRect;
  onAdd: (name: string, type: ColType) => void;
  onCancel: () => void;
}
function AddColumnModal({ anchorRect, onAdd, onCancel }: AddColProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColType>("text");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const types: ColType[] = ["text", "number", "select", "date", "url"];

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onCancel]);

  // Viewport-aware positioning: prefer below-left-aligned, flip if needed
  const PANEL_W = 230;
  const PANEL_H = 170; // estimate

  let left = anchorRect.left;
  let top  = anchorRect.bottom + 4;

  // Flip right if overflows viewport right edge
  if (left + PANEL_W > window.innerWidth - 8) {
    left = anchorRect.right - PANEL_W;
  }
  left = Math.max(8, left);

  // Flip above if overflows viewport bottom
  if (top + PANEL_H > window.innerHeight - 8) {
    top = anchorRect.top - PANEL_H - 4;
  }
  top = Math.max(8, top);

  return createPortal(
    <div
      ref={panelRef}
      className="tbl-add-col-modal"
      style={{ position: "fixed", left, top, width: PANEL_W }}
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="tbl-add-col-input"
        placeholder="Column name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter") onAdd(name.trim() || "Column", type);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="tbl-add-col-types">
        {types.map(t => (
          <button
            key={t}
            className={`tbl-type-btn${type === t ? " active" : ""}`}
            onClick={() => setType(t)}
          >
            <ColIcon type={t} />
            <span>{t}</span>
          </button>
        ))}
      </div>
      <div className="tbl-add-col-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="tbl-add-col-confirm" onClick={() => onAdd(name.trim() || "Column", type)}>Add</button>
      </div>
    </div>,
    document.body
  );
}

// ── Select dropdown (portal) ──────────────────────────────────────────────────

interface SelectDropdownProps {
  col: TableColumn;
  currentValue: string;
  x: number; y: number;
  onSelect: (label: string) => void;
  onAddOption: (label: string) => void;
  onClose: () => void;
}
function SelectDropdown({ col, currentValue, x, y, onSelect, onAddOption, onClose }: SelectDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [newOpt, setNewOpt] = useState("");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onClose]);

  const estHeight = col.options.length * 36 + 80;
  const top = y + estHeight > window.innerHeight - 8 ? y - estHeight : y;
  const left = Math.min(x, window.innerWidth - 180);

  return createPortal(
    <div ref={ref} className="tbl-select-dropdown" style={{ left, top }}>
      {currentValue && (
        <div className="tbl-select-option" onClick={() => { onSelect(""); onClose(); }}>
          <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Clear</span>
        </div>
      )}
      {col.options.map(opt => (
        <div
          key={opt.label}
          className={`tbl-select-option${currentValue === opt.label ? " selected" : ""}`}
          onClick={() => { onSelect(opt.label); onClose(); }}
        >
          <span className="tbl-select-dot" style={{ background: opt.color }} />
          <span style={{ color: opt.color }}>{opt.label}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
        <input
          className="tbl-select-add-input"
          placeholder="Add option…"
          value={newOpt}
          onChange={e => setNewOpt(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === "Enter" && newOpt.trim()) { onAddOption(newOpt.trim()); onClose(); }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
    </div>,
    document.body
  );
}

// ── Main TableView ────────────────────────────────────────────────────────────

interface Props { tableId: string; }

export default function TableView({ tableId }: Props) {
  const [tableName, setTableName] = useState("");
  const [nameEditing, setNameEditing] = useState(false);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [cells, setCells] = useState<CellMap>({});

  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [selectOpen, setSelectOpen] = useState<{ rowId: string; colId: string; x: number; y: number } | null>(null);

  // Add column modal — store the anchor DOMRect for portal positioning
  const [addColAnchor, setAddColAnchor] = useState<DOMRect | null>(null);
  const addColBtnRef = useRef<HTMLButtonElement>(null);

  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [renamingColId, setRenamingColId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // ── Resize state ──────────────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const colResizeRef = useRef<{ id: string; startX: number; startW: number } | null>(null);
  const rowResizeRef = useRef<{ id: string; startY: number; startH: number } | null>(null);

  useEffect(() => { if (renamingColId) renameRef.current?.focus(); }, [renamingColId]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const db = await getDb();
    const [meta, rawCols, rawRows] = await Promise.all([
      db.select<{ name: string }[]>("SELECT name FROM db_tables WHERE id = ?", [tableId]),
      db.select<RawColumn[]>("SELECT * FROM table_columns WHERE table_id = ? ORDER BY position ASC", [tableId]),
      db.select<TableRow[]>("SELECT * FROM table_rows WHERE table_id = ? ORDER BY position ASC, created_at ASC", [tableId]),
    ]);
    setTableName(meta[0]?.name ?? "");
    const cols: TableColumn[] = rawCols.map(c => ({
      ...c,
      col_type: c.col_type as ColType,
      options: JSON.parse(c.options ?? "[]") as SelectOption[],
    }));
    setColumns(cols);
    setRows(rawRows);

    if (rawRows.length === 0) { setCells({}); return; }
    const rowIds = rawRows.map(r => `'${r.id}'`).join(",");
    const rawCells = await db.select<RawCell[]>(
      `SELECT row_id, col_id, value FROM table_cells WHERE row_id IN (${rowIds})`
    );
    const map: CellMap = {};
    for (const c of rawCells) map[`${c.row_id}:${c.col_id}`] = c.value;
    setCells(map);
  }, [tableId]);

  useEffect(() => { load(); }, [load]);

  // ── Column resize ─────────────────────────────────────────────────────────

  function startColResize(e: React.MouseEvent, colId: string) {
    e.preventDefault(); e.stopPropagation();
    colResizeRef.current = { id: colId, startX: e.clientX, startW: colWidths[colId] ?? DEFAULT_COL_W };

    function onMove(ev: MouseEvent) {
      if (!colResizeRef.current) return;
      const newW = Math.max(60, colResizeRef.current.startW + (ev.clientX - colResizeRef.current.startX));
      setColWidths(prev => ({ ...prev, [colResizeRef.current!.id]: newW }));
    }
    function onUp() {
      colResizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Row resize ────────────────────────────────────────────────────────────

  function startRowResize(e: React.MouseEvent, rowId: string) {
    e.preventDefault(); e.stopPropagation();
    rowResizeRef.current = { id: rowId, startY: e.clientY, startH: rowHeights[rowId] ?? DEFAULT_ROW_H };

    function onMove(ev: MouseEvent) {
      if (!rowResizeRef.current) return;
      const newH = Math.max(28, rowResizeRef.current.startH + (ev.clientY - rowResizeRef.current.startY));
      setRowHeights(prev => ({ ...prev, [rowResizeRef.current!.id]: newH }));
    }
    function onUp() {
      rowResizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Cell editing ──────────────────────────────────────────────────────────

  function startEdit(rowId: string, colId: string) {
    setEditingCell({ rowId, colId });
    setEditingValue(cells[`${rowId}:${colId}`] ?? "");
  }

  async function commitEdit(rowId: string, colId: string, value: string) {
    setEditingCell(null);
    setCells(prev => ({ ...prev, [`${rowId}:${colId}`]: value }));
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO table_cells (row_id, col_id, value) VALUES (?, ?, ?)",
      [rowId, colId, value]
    );
  }

  // ── Row ops ───────────────────────────────────────────────────────────────

  async function addRow() {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO table_rows (id, table_id, position, created_at) VALUES (?, ?, ?, ?)",
      [id, tableId, rows.length, Date.now()]
    );
    setRows(prev => [...prev, { id, table_id: tableId, position: prev.length, created_at: Date.now() }]);
  }

  async function deleteRow(rowId: string) {
    const db = await getDb();
    await db.execute("DELETE FROM table_cells WHERE row_id = ?", [rowId]);
    await db.execute("DELETE FROM table_rows WHERE id = ?", [rowId]);
    setRows(prev => prev.filter(r => r.id !== rowId));
    setCells(prev => {
      const next = { ...prev };
      Object.keys(next).filter(k => k.startsWith(rowId + ":")).forEach(k => delete next[k]);
      return next;
    });
  }

  // ── Column ops ────────────────────────────────────────────────────────────

  async function addColumn(name: string, col_type: ColType) {
    setAddColAnchor(null);
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO table_columns (id, table_id, name, col_type, options, position) VALUES (?, ?, ?, ?, ?, ?)",
      [id, tableId, name, col_type, "[]", columns.length]
    );
    await load();
  }

  async function deleteColumn(colId: string) {
    const db = await getDb();
    await db.execute("DELETE FROM table_cells WHERE col_id = ?", [colId]);
    await db.execute("DELETE FROM table_columns WHERE id = ?", [colId]);
    await load();
  }

  async function renameColumn(colId: string, name: string) {
    setRenamingColId(null);
    if (!name.trim()) return;
    const db = await getDb();
    await db.execute("UPDATE table_columns SET name = ? WHERE id = ?", [name.trim(), colId]);
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, name: name.trim() } : c));
  }

  async function changeColumnType(colId: string, col_type: ColType) {
    const db = await getDb();
    await db.execute("UPDATE table_columns SET col_type = ? WHERE id = ?", [col_type, colId]);
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, col_type } : c));
  }

  async function addSelectOption(colId: string, label: string) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    const color = SELECT_COLORS[col.options.length % SELECT_COLORS.length];
    const newOptions = [...col.options, { label, color }];
    const db = await getDb();
    await db.execute("UPDATE table_columns SET options = ? WHERE id = ?", [JSON.stringify(newOptions), colId]);
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, options: newOptions } : c));
  }

  // ── Table name ────────────────────────────────────────────────────────────

  async function commitTableName(name: string) {
    setNameEditing(false);
    if (!name.trim()) return;
    setTableName(name.trim());
    const db = await getDb();
    await db.execute("UPDATE db_tables SET name = ? WHERE id = ?", [name.trim(), tableId]);
  }

  // ── Context menus ─────────────────────────────────────────────────────────

  function colCtx(e: React.MouseEvent, col: TableColumn) {
    e.preventDefault(); e.stopPropagation();
    const typeItems: CtxItem[] = (["text","number","select","date","url"] as ColType[]).map(t => ({
      label: t.charAt(0).toUpperCase() + t.slice(1),
      onClick: () => changeColumnType(col.id, t),
    }));
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Rename", onClick: () => { setRenamingColId(col.id); setRenameValue(col.name); } },
      ...typeItems.map((item, i) => i === 0 ? { ...item, separator: true } : item),
      { label: "Delete Column", onClick: () => deleteColumn(col.id), danger: true, separator: true },
    ]});
  }

  function rowCtx(e: React.MouseEvent, rowId: string) {
    e.preventDefault(); e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: [
      { label: "Delete Row", onClick: () => deleteRow(rowId), danger: true },
    ]});
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="tbl-view">
      {/* Header */}
      <div className="tbl-view-header">
        {nameEditing ? (
          <input
            className="tbl-view-title"
            autoFocus
            defaultValue={tableName}
            onBlur={e => commitTableName(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitTableName(e.currentTarget.value); if (e.key === "Escape") setNameEditing(false); }}
          />
        ) : (
          <span className="tbl-view-title" style={{ cursor: "text" }} onDoubleClick={() => setNameEditing(true)}>
            {tableName}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="tbl-td-num" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--bg-1)" }}>#</th>
              {columns.map(col => {
                const w = colWidths[col.id] ?? DEFAULT_COL_W;
                return (
                  <th key={col.id} style={{ width: w, minWidth: w, maxWidth: w }} onContextMenu={e => colCtx(e, col)}>
                    <div className="tbl-th-inner">
                      <ColIcon type={col.col_type} />
                      {renamingColId === col.id ? (
                        <input
                          ref={renameRef}
                          className="tbl-th-rename-input"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => renameColumn(col.id, renameValue)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") renameColumn(col.id, renameValue); if (e.key === "Escape") setRenamingColId(null); }}
                        />
                      ) : (
                        <span
                          style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          onDoubleClick={() => { setRenamingColId(col.id); setRenameValue(col.name); }}
                        >
                          {col.name}
                        </span>
                      )}
                      {col.col_type === "select" && <ChevronDown size={10} style={{ flexShrink: 0, opacity: 0.5 }} />}
                    </div>
                    {/* Column resize handle */}
                    <div className="tbl-col-resize-handle" onMouseDown={e => startColResize(e, col.id)} />
                  </th>
                );
              })}
              <th className="tbl-th-add">
                <button
                  ref={addColBtnRef}
                  className="tbl-th-add-btn"
                  onClick={() => {
                    const rect = addColBtnRef.current?.getBoundingClientRect();
                    setAddColAnchor(rect ?? null);
                  }}
                  title="Add column"
                >
                  <Plus size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const h = rowHeights[row.id] ?? DEFAULT_ROW_H;
              return (
                <tr key={row.id} onContextMenu={e => rowCtx(e, row.id)}>
                  <td className="tbl-td-num" style={{ height: h, position: "relative" }}>
                    <span>{idx + 1}</span>
                    {/* Row resize handle */}
                    <div className="tbl-row-resize-handle" onMouseDown={e => startRowResize(e, row.id)} />
                  </td>
                  {columns.map(col => {
                    const key = `${row.id}:${col.id}`;
                    const value = cells[key] ?? "";
                    const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                    const w = colWidths[col.id] ?? DEFAULT_COL_W;

                    return (
                      <td key={col.id} className="tbl-td" style={{ height: h, width: w, maxWidth: w }}>
                        {isEditing && col.col_type !== "select" ? (
                          <input
                            className="tbl-cell-input"
                            autoFocus
                            type={col.col_type === "number" ? "number" : col.col_type === "date" ? "date" : col.col_type === "url" ? "url" : "text"}
                            value={editingValue}
                            onChange={e => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(row.id, col.id, editingValue)}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === "Enter") commitEdit(row.id, col.id, editingValue);
                              if (e.key === "Escape") setEditingCell(null);
                              if (e.key === "Tab") { e.preventDefault(); commitEdit(row.id, col.id, editingValue); }
                            }}
                          />
                        ) : (
                          <div
                            className={`tbl-cell-display${!value ? " empty" : ""}`}
                            onClick={e => {
                              if (col.col_type === "select") {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setSelectOpen({ rowId: row.id, colId: col.id, x: rect.left, y: rect.bottom });
                              } else {
                                startEdit(row.id, col.id);
                              }
                            }}
                          >
                            {col.col_type === "select" && value ? (
                              (() => {
                                const opt = col.options.find(o => o.label === value);
                                return opt ? <SelectPill label={opt.label} color={opt.color} /> : <span>{value}</span>;
                              })()
                            ) : col.col_type === "date" && value ? (
                              <span>{new Date(value + "T00:00:00").toLocaleDateString()}</span>
                            ) : col.col_type === "url" && value ? (
                              <span className="tbl-url-link">
                                <span
                                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                  onClick={e => { e.stopPropagation(); startEdit(row.id, col.id); }}
                                >
                                  {value}
                                </span>
                                <ExternalLink
                                  size={11}
                                  style={{ flexShrink: 0, cursor: "pointer" }}
                                  onClick={e => { e.stopPropagation(); tauriOpenUrl(value).catch(() => {}); }}
                                />
                              </span>
                            ) : (
                              <span>{value || ""}</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              );
            })}
            {/* Add row */}
            <tr>
              <td className="tbl-td-num" />
              <td
                className="tbl-add-row-cell"
                colSpan={Math.max(columns.length, 1)}
                onClick={addRow}
              >
                + New row
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Add column modal (portal) */}
      {addColAnchor && (
        <AddColumnModal
          anchorRect={addColAnchor}
          onAdd={addColumn}
          onCancel={() => setAddColAnchor(null)}
        />
      )}

      {/* Select dropdown */}
      {selectOpen && (() => {
        const col = columns.find(c => c.id === selectOpen.colId);
        if (!col) return null;
        return (
          <SelectDropdown
            col={col}
            currentValue={cells[`${selectOpen.rowId}:${selectOpen.colId}`] ?? ""}
            x={selectOpen.x} y={selectOpen.y}
            onSelect={v => commitEdit(selectOpen.rowId, selectOpen.colId, v)}
            onAddOption={async label => {
              await addSelectOption(selectOpen.colId, label);
              await commitEdit(selectOpen.rowId, selectOpen.colId, label);
            }}
            onClose={() => setSelectOpen(null)}
          />
        );
      })()}

      {/* Context menu */}
      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
