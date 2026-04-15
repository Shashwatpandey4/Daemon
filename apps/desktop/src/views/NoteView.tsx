import { useState, useEffect, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import Mention from "@tiptap/extension-mention";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import MentionList, { type MentionItem } from "../components/MentionList";
import type { ActiveView } from "../App";

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

async function queryAllItems(query: string): Promise<MentionItem[]> {
  const db = await getDb();
  const like = `%${query}%`;
  const [docs, boards, spaces] = await Promise.all([
    db.select<{ id: string; title: string }[]>(
      "SELECT id, title FROM space_nodes WHERE node_type = 'doc' AND title LIKE ? LIMIT 8", [like]
    ),
    db.select<{ id: string; name: string }[]>(
      "SELECT id, name FROM whiteboards WHERE name LIKE ? LIMIT 4", [like]
    ),
    db.select<{ id: string; name: string }[]>(
      "SELECT id, name FROM spaces WHERE name LIKE ? LIMIT 4", [like]
    ),
  ]);
  return [
    ...docs.map(d => ({ id: d.id, label: d.title, itemType: "doc" as const })),
    ...boards.map(b => ({ id: b.id, label: b.name, itemType: "whiteboard" as const })),
    ...spaces.map(s => ({ id: s.id, label: s.name, itemType: "space" as const })),
  ];
}

interface Props {
  noteId: string;
  onNavigate?: (view: ActiveView) => void;
}

export default function NoteView({ noteId, onNavigate }: Props) {
  const [title, setTitle] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "">("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialContentRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({ placeholder: "Start writing… Use [[ to link to notes, boards, or spaces" }),
      Mention.configure({
        HTMLAttributes: { class: "mention-chip" },
        renderHTML({ node }) {
          return [
            "span",
            {
              class: "mention-chip",
              "data-mention-id": node.attrs.id,
              "data-mention-type": node.attrs.itemType ?? "",
            },
            `[[${node.attrs.label ?? node.attrs.id}]]`,
          ];
        },
        suggestion: {
          char: "[[",
          allowSpaces: true,
          items: async ({ query }) => {
            return queryAllItems(query);
          },
          render: () => {
            let renderer: ReactRenderer<{ onKeyDown: (e: KeyboardEvent) => boolean }>;
            let popup: HTMLDivElement;

            return {
              onStart(props: SuggestionProps) {
                renderer = new ReactRenderer(MentionList, {
                  props: { ...props, items: props.items as MentionItem[] },
                  editor: props.editor,
                });
                popup = document.createElement("div");
                popup.style.cssText = "position:fixed;z-index:9999;";
                document.body.appendChild(popup);
                popup.appendChild(renderer.element);

                const rect = props.clientRect?.();
                if (rect) {
                  popup.style.left = `${rect.left}px`;
                  popup.style.top = `${rect.bottom + 4}px`;
                }
              },
              onUpdate(props: SuggestionProps) {
                renderer.updateProps({ ...props, items: props.items as MentionItem[] });
                const rect = props.clientRect?.();
                if (rect && popup) {
                  popup.style.left = `${rect.left}px`;
                  popup.style.top = `${rect.bottom + 4}px`;
                }
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                return renderer.ref?.onKeyDown(props.event) ?? false;
              },
              onExit() {
                renderer.destroy();
                popup?.remove();
              },
            };
          },
        },
      }),
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

  // Navigate on clicking a mention chip
  function handleEditorClick(e: React.MouseEvent) {
    if (!onNavigate) return;
    const target = (e.target as HTMLElement).closest("[data-mention-id]") as HTMLElement | null;
    if (!target) return;
    const id = target.getAttribute("data-mention-id") ?? "";
    const itemType = target.getAttribute("data-mention-type") ?? "";
    if (!id) return;
    if (itemType === "doc") onNavigate({ type: "note", noteId: id });
    else if (itemType === "whiteboard") onNavigate({ type: "whiteboard", boardId: id });
    else if (itemType === "space") onNavigate({ type: "spaces", spaceId: id });
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
      <div className="note-editor-wrap" onClick={handleEditorClick}>
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );
}
