import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { FileText, Image, File, FileCode, Trash2, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export interface FileNodeData {
  title: string;
  file_path: string;
  onDelete: (id: string) => void;
  [key: string]: unknown;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return <FileText size={16} color="#ef4444" />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return <Image size={16} color="#22c55e" />;
  if (["md", "txt", "csv"].includes(ext)) return <FileCode size={16} color="#3b82f6" />;
  return <File size={16} color="#999" />;
}

function extBadge(name: string) {
  return (name.split(".").pop()?.toUpperCase() ?? "FILE").slice(0, 4);
}

export const FileNode = memo(({ id, data }: NodeProps) => {
  const d = data as FileNodeData;
  const fileName = d.file_path.split("/").pop() ?? d.title;

  async function openFile(e: React.MouseEvent) {
    e.stopPropagation();
    try { await invoke("open_file", { path: d.file_path }); }
    catch (err) { console.error("open failed", err); }
  }

  return (
    <div className="file-node">
      <Handle type="target" position={Position.Left} />

      <div className="file-node-icon">{fileIcon(fileName)}</div>

      <div className="file-node-body">
        <span className="file-node-title" title={d.title}>{d.title}</span>
        <span className="file-node-ext">{extBadge(fileName)}</span>
      </div>

      <div className="file-node-actions">
        <button className="lna-btn" onClick={openFile} title="Open file">
          <ExternalLink size={11} />
        </button>
        <button
          className="lna-btn danger"
          onClick={e => { e.stopPropagation(); d.onDelete(id); }}
          title="Remove from space"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

FileNode.displayName = "FileNode";
