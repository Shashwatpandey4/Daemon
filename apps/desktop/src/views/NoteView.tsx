import { useState, useEffect, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

export default function NoteView({ noteId }: { noteId: string }) {
  const [title, setTitle] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "">("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialContentRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: "",
    onUpdate({ editor }) {
      if (initialContentRef.current === null) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown.getMarkdown();
      scheduleSave(title, md);
    },
  });

  // Load note content once on mount / noteId change
  useEffect(() => {
    if (!editor) return;
    initialContentRef.current = null;
    (async () => {
      const db = await getDb();
      const rows = await db.select<{ title: string; content: string | null }[]>(
        "SELECT title, content FROM space_nodes WHERE id = ?", [noteId]
      );
      if (rows[0]) {
        setTitle(rows[0].title);
        const md = rows[0].content ?? "";
        initialContentRef.current = md;
        editor.commands.setContent(md);
      } else {
        initialContentRef.current = "";
      }
    })();
  }, [noteId, editor]);

  // Keep title ref in sync for the onUpdate closure
  const titleRef = useRef(title);
  useEffect(() => { titleRef.current = title; }, [title]);

  function scheduleSave(t: string, c: string) {
    setSaveStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const db = await getDb();
      await db.execute("UPDATE space_nodes SET title = ?, content = ? WHERE id = ?", [t, c, noteId]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    }, 800);
  }

  function onTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value);
    if (editor && initialContentRef.current !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scheduleSave(e.target.value, (editor.storage as any).markdown.getMarkdown());
    }
  }

  return (
    <div className="note-view">
      <div className="note-header">
        <input
          className="note-title-input"
          value={title}
          onChange={onTitleChange}
          placeholder="Untitled"
        />
        {saveStatus && (
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>
      <div className="note-editor-wrap">
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );
}
