import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { FileText, Image, File, FileCode, Globe, StickyNote, Trash2, ExternalLink, Pencil } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

export interface NodeCardData {
  title: string;
  content: string | null;
  url: string | null;
  file_path: string | null;
  node_type: "link" | "file" | "note";
  tags: string[];
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  [key: string]: unknown;
}

// Deterministic color from tag string
const TAG_COLORS = [
  "#7c6fcd", "#3b82f6", "#22c55e", "#f59e0b",
  "#ef4444", "#ec4899", "#06b6d4", "#8b5cf6",
];
function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function typeIcon(type: string, filePath: string | null) {
  if (type === "link") return <Globe size={13} color="#3b82f6" />;
  if (type === "note") return <StickyNote size={13} color="#f59e0b" />;
  const ext = (filePath ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return <FileText size={13} color="#ef4444" />;
  if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return <Image size={13} color="#22c55e" />;
  if (["md","txt","csv"].includes(ext)) return <FileCode size={13} color="#3b82f6" />;
  return <File size={13} color="#999" />;
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

export const NodeCard = memo(({ id, data }: NodeProps) => {
  const d = data as NodeCardData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function commitRename() {
    const t = draft.trim() || d.title;
    setEditing(false);
    d.onRename(id, t);
  }

  async function openItem(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (d.node_type === "link" && d.url) await tauriOpenUrl(d.url);
      else if (d.node_type === "file" && d.file_path) await invoke("open_file", { path: d.file_path });
    } catch (err) { console.error(err); }
  }

  const canOpen = (d.node_type === "link" && !!d.url) || (d.node_type === "file" && !!d.file_path);
  const subtitle = d.node_type === "link" && d.url
    ? hostname(d.url)
    : d.node_type === "file" && d.file_path
    ? d.file_path.split("/").pop()
    : d.content
    ? d.content.slice(0, 60) + (d.content.length > 60 ? "…" : "")
    : null;

  return (
    <div className="node-card">
      <Handle type="target" position={Position.Left} />

      {/* Header: icon + title */}
      <div className="nc-header">
        <span className="nc-icon">{typeIcon(d.node_type, d.file_path)}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="nc-title-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <span className="nc-title" onDoubleClick={() => setEditing(true)} title={d.title}>
            {d.title}
          </span>
        )}
      </div>

      {/* Subtitle: domain / filename / content preview */}
      {subtitle && <div className="nc-subtitle">{subtitle}</div>}

      {/* Tags */}
      {d.tags.length > 0 && (
        <div className="nc-tags">
          {d.tags.map(tag => (
            <span key={tag} className="nc-tag" style={{ background: tagColor(tag) + "22", color: tagColor(tag), borderColor: tagColor(tag) + "55" }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="nc-actions">
        <button className="lna-btn" onClick={() => setEditing(true)} title="Rename"><Pencil size={11} /></button>
        {canOpen && <button className="lna-btn" onClick={openItem} title="Open"><ExternalLink size={11} /></button>}
        <button className="lna-btn danger" onClick={e => { e.stopPropagation(); d.onDelete(id); }} title="Delete">
          <Trash2 size={11} />
        </button>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

NodeCard.displayName = "NodeCard";
