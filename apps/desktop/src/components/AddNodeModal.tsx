import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { X, Paperclip } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

export interface NodeDraft {
  title: string;
  content: string;
  tags: string[];
  filePath: string | null;
}

interface Props {
  onAdd: (draft: NodeDraft) => void;
  onClose: () => void;
}

function tagColor(tag: string) {
  const colors = ["#7c6fcd","#3b82f6","#22c55e","#f59e0b","#ef4444","#ec4899","#06b6d4","#8b5cf6"];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

export default function AddNodeModal({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) setTags(prev => [...prev, tag]);
    setTagInput("");
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); }
    if (e.key === "Backspace" && tagInput === "") setTags(prev => prev.slice(0, -1));
  }

  function removeTag(tag: string) { setTags(prev => prev.filter(t => t !== tag)); }

  async function pickFile() {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Documents", extensions: ["pdf", "md", "txt", "docx", "csv"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (selected && !Array.isArray(selected)) {
      setFilePath(selected);
      if (!title) setTitle(selected.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "");
    }
  }

  function clearFile() { setFilePath(null); }

  function submit() {
    const t = title.trim() || content.trim().slice(0, 40) || (filePath?.split("/").pop() ?? "Node");
    onAdd({ title: t, content: content.trim(), tags, filePath });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal add-node-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Add Node</h3>
          <button className="modal-close" onClick={onClose}><X size={15} /></button>
        </div>

        <input
          ref={titleRef}
          className="modal-input"
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
        />

        <textarea
          className="modal-textarea"
          placeholder="Content — paste a URL, write notes, or leave blank"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={3}
        />

        {/* Tags */}
        <div className="tag-input-row">
          {tags.map(tag => (
            <span key={tag} className="tag-chip" style={{ background: tagColor(tag) + "22", color: tagColor(tag), borderColor: tagColor(tag) + "55" }}>
              {tag}
              <button className="tag-remove" onClick={() => removeTag(tag)}><X size={9} /></button>
            </span>
          ))}
          <input
            className="tag-input"
            placeholder={tags.length === 0 ? "Add tags (Enter or comma)…" : ""}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={() => tagInput.trim() && addTag(tagInput)}
          />
        </div>

        {/* File attach */}
        {filePath ? (
          <div className="file-pill">
            <Paperclip size={12} />
            <span className="file-pill-name">{filePath.split("/").pop()}</span>
            <button className="tag-remove" onClick={clearFile}><X size={10} /></button>
          </div>
        ) : (
          <button className="attach-btn" onClick={pickFile}>
            <Paperclip size={13} /> Attach file
          </button>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>Add</button>
        </div>
      </div>
    </div>
  );
}
