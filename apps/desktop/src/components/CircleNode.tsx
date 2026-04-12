import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

export interface CircleNodeData {
  title: string;
  node_type: "link" | "file" | "note";
  tags: string[];
  onDelete: (id: string) => void;
  [key: string]: unknown;
}

const TAG_COLORS = [
  "#7c6fcd","#3b82f6","#22c55e","#f59e0b",
  "#ef4444","#ec4899","#06b6d4","#8b5cf6",
];

export function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

const TYPE_COLORS: Record<string, string> = {
  link: "#3b82f6",
  file: "#ef4444",
  note: "#f59e0b",
};

export const CircleNode = memo(({ id, data }: NodeProps) => {
  const d = data as CircleNodeData;
  const color = d.tags.length > 0 ? tagColor(d.tags[0]) : TYPE_COLORS[d.node_type] ?? "#7c6fcd";

  // First letters of title (up to 2 words)
  const initials = d.title
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="circle-node"
      style={{ "--node-color": color } as React.CSSProperties}
      title={d.title}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div className="circle-node-inner">
        <span className="circle-node-initials">{initials || "?"}</span>
      </div>
      <span className="circle-node-label">{d.title}</span>

      <button
        className="circle-node-delete"
        onClick={e => { e.stopPropagation(); d.onDelete(id); }}
        title="Delete node"
      >×</button>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

CircleNode.displayName = "CircleNode";
