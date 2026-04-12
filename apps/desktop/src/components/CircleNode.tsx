import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

export interface CircleNodeData {
  title: string;
  node_type: "link" | "file" | "note";
  tags: string[];
  color: string | null;
  onDelete: (id: string) => void;
  onColorChange: (id: string, color: string) => void;
  [key: string]: unknown;
}

export const PALETTE = [
  "#7c6fcd", "#3b82f6", "#06b6d4", "#22c55e",
  "#84cc16", "#f59e0b", "#f97316", "#ef4444",
  "#ec4899", "#8b5cf6", "#e2e8f0", "#64748b",
];

const TYPE_DEFAULTS: Record<string, string> = {
  link: "#3b82f6",
  file: "#ef4444",
  note: "#f59e0b",
};

export function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const CircleNode = memo(({ id, data }: NodeProps) => {
  const d = data as CircleNodeData;
  const [showPalette, setShowPalette] = useState(false);

  const color = d.color
    ?? (d.tags.length > 0 ? tagColor(d.tags[0]) : TYPE_DEFAULTS[d.node_type] ?? "#7c6fcd");

  const initials = d.title
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

  return (
    <div
      className="circle-node"
      style={{ "--node-color": color } as React.CSSProperties}
      title={showPalette ? undefined : d.title}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div className="circle-node-inner">
        <span className="circle-node-initials">{initials}</span>
      </div>
      <span className="circle-node-label">{d.title}</span>

      {/* Color picker trigger */}
      <button
        className="circle-node-color-btn"
        onClick={e => { e.stopPropagation(); setShowPalette(v => !v); }}
        title="Change color"
        style={{ background: color }}
      />

      {/* Delete */}
      <button
        className="circle-node-delete"
        onClick={e => { e.stopPropagation(); d.onDelete(id); }}
        title="Delete node"
      >×</button>

      {/* Color palette */}
      {showPalette && (
        <div className="color-palette" onClick={e => e.stopPropagation()}>
          {PALETTE.map(c => (
            <button
              key={c}
              className={`color-swatch ${c === color ? "active" : ""}`}
              style={{ background: c }}
              onClick={e => { e.stopPropagation(); d.onColorChange(id, c); setShowPalette(false); }}
            />
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

CircleNode.displayName = "CircleNode";
