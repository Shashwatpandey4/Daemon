import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const TEXT_EXTS = new Set([
  "txt","md","py","js","ts","tsx","jsx","json","yaml","yml","toml",
  "css","html","htm","sh","bash","zsh","rs","c","cpp","cc","h","hpp",
  "go","java","rb","php","vue","svelte","xml","csv","sql","r","lua",
  "makefile","dockerfile","gitignore","env","conf","ini","cfg",
]);

export function isTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  const base = lower.split("/").pop() ?? "";
  return TEXT_EXTS.has(ext) || base === "makefile" || base === "dockerfile";
}

interface Props {
  filePath: string;
}

const SAVE_DEBOUNCE = 800;

export default function TextFileView({ filePath }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileName = filePath.split("/").pop() ?? filePath;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    setContent(null);
    setError(null);
    invoke<ArrayBuffer>("read_file_bytes", { path: filePath })
      .then(buf => {
        const text = new TextDecoder("utf-8").decode(new Uint8Array(buf));
        setContent(text);
      })
      .catch(err => setError(String(err)));
  }, [filePath]);

  const save = useCallback(async (text: string) => {
    setSaveStatus("saving");
    try {
      await invoke("write_text_file", { path: filePath, content: text });
      setSaveStatus("saved");
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(""), 2000);
    } catch { setSaveStatus(""); }
  }, [filePath]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setContent(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(text), SAVE_DEBOUNCE);
  }

  const isCode = !["txt", "md", "csv"].includes(ext);

  return (
    <div className="textfile-view">
      <div className="textfile-header">
        <span className="textfile-name">{fileName}</span>
        {saveStatus && (
          <span className={`textfile-save-status ${saveStatus}`}>
            {saveStatus === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>

      <div className="textfile-body">
        {error && (
          <div className="textfile-error">Failed to load file: {error}</div>
        )}
        {content === null && !error && (
          <div className="textfile-loading">Loading…</div>
        )}
        {content !== null && (
          <textarea
            className={`textfile-editor${isCode ? " textfile-code" : ""}`}
            value={content}
            onChange={onChange}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
