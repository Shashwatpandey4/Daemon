import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

export interface LinkNodeData {
  title: string;
  url: string;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  [key: string]: unknown;
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function favicon(url: string) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
  catch { return null; }
}

export const LinkNode = memo(({ id, data }: NodeProps) => {
  const d = data as LinkNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function commitRename() {
    const trimmed = draft.trim() || hostname(d.url);
    setEditing(false);
    d.onRename(id, trimmed);
  }

  async function openUrl(e: React.MouseEvent) {
    e.stopPropagation();
    try { await tauriOpenUrl(d.url); }
    catch { window.open(d.url, "_blank"); }
  }

  return (
    <div className="link-node">
      <Handle type="target" position={Position.Left} />

      <div className="link-node-header">
        {favicon(d.url) && (
          <img src={favicon(d.url)!} alt="" className="link-favicon" onError={e => (e.currentTarget.style.display = "none")} />
        )}
        {editing ? (
          <input
            ref={inputRef}
            className="link-node-title-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <span className="link-node-title" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {d.title}
          </span>
        )}
      </div>

      <div className="link-node-domain">{hostname(d.url)}</div>

      <div className="link-node-actions">
        <button className="lna-btn" onClick={() => setEditing(true)} title="Rename"><Pencil size={11} /></button>
        <button className="lna-btn" onClick={openUrl} title="Open link"><ExternalLink size={11} /></button>
        <button className="lna-btn danger" onClick={e => { e.stopPropagation(); d.onDelete(id); }} title="Delete">
          <Trash2 size={11} />
        </button>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

LinkNode.displayName = "LinkNode";
