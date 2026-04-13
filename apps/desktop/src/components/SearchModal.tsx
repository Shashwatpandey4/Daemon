import { useState, useEffect, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { Search, CheckSquare, Pencil, Boxes, StickyNote, FileText } from "lucide-react";
import type { ActiveView } from "../App";

interface SearchResult {
  id: string;
  type: "todo" | "whiteboard" | "space" | "node" | "note";
  title: string;
  subtitle?: string;
  spaceId?: string;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

interface Props {
  onNavigate: (view: ActiveView) => void;
  onClose: () => void;
}

export default function SearchModal({ onNavigate, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); setSelected(0); return; }
    timerRef.current = setTimeout(() => doSearch(query.trim()), 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  async function doSearch(q: string) {
    const db = await getDb();
    const like = `%${q}%`;
    const [todos, boards, spaces, nodes] = await Promise.all([
      db.select<{ id: string; title: string }[]>(
        "SELECT id, title FROM todos WHERE deleted = 0 AND title LIKE ? LIMIT 5", [like]),
      db.select<{ id: string; name: string }[]>(
        "SELECT id, name FROM whiteboards WHERE name LIKE ? LIMIT 5", [like]),
      db.select<{ id: string; name: string }[]>(
        "SELECT id, name FROM spaces WHERE name LIKE ? LIMIT 5", [like]),
      db.select<{ id: string; title: string; content: string | null; space_id: string; node_type: string }[]>(
        "SELECT id, title, content, space_id, node_type FROM space_nodes WHERE title LIKE ? OR content LIKE ? LIMIT 10", [like, like]),
    ]);

    setResults([
      ...todos.map(t => ({ id: t.id, type: "todo" as const, title: t.title })),
      ...boards.map(b => ({ id: b.id, type: "whiteboard" as const, title: b.name })),
      ...spaces.map(s => ({ id: s.id, type: "space" as const, title: s.name })),
      ...nodes.map(n => ({
        id: n.id,
        type: n.node_type === "doc" ? "note" as const : "node" as const,
        title: n.title,
        subtitle: n.content?.slice(0, 60) || undefined,
        spaceId: n.space_id,
      })),
    ]);
    setSelected(0);
  }

  function navigate(r: SearchResult) {
    onClose();
    if (r.type === "whiteboard") onNavigate({ type: "whiteboard", boardId: r.id });
    else if (r.type === "space") onNavigate({ type: "spaces", spaceId: r.id });
    else if (r.type === "note") onNavigate({ type: "note", noteId: r.id });
    else if (r.type === "node" && r.spaceId) onNavigate({ type: "spaces", spaceId: r.spaceId });
    // todos: just close, they're always visible in the sidebar
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[selected]) navigate(results[selected]);
  }

  function typeIcon(type: SearchResult["type"]) {
    if (type === "todo") return <CheckSquare size={13} />;
    if (type === "whiteboard") return <Pencil size={13} />;
    if (type === "space") return <Boxes size={13} />;
    if (type === "note") return <FileText size={13} />;
    return <StickyNote size={13} />;
  }

  const TYPE_LABEL: Record<SearchResult["type"], string> = {
    todo: "Todo", whiteboard: "Whiteboard", space: "Space", node: "Node", note: "Note",
  };

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="search-input-row">
          <Search size={14} className="search-icon" />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search everything…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <kbd className="search-esc">Esc</kbd>
        </div>

        {results.length > 0 && (
          <ul className="search-results">
            {results.map((r, i) => (
              <li
                key={r.id + r.type}
                className={`search-result-item${i === selected ? " selected" : ""}`}
                onClick={() => navigate(r)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="search-result-icon">{typeIcon(r.type)}</span>
                <span className="search-result-body">
                  <span className="search-result-title">{r.title}</span>
                  {r.subtitle && <span className="search-result-sub">{r.subtitle}</span>}
                </span>
                <span className="search-result-type">{TYPE_LABEL[r.type]}</span>
              </li>
            ))}
          </ul>
        )}

        {query.trim() && results.length === 0 && (
          <p className="search-empty">No results for "{query}"</p>
        )}

        {!query.trim() && (
          <p className="search-hint">Start typing to search todos, notes, spaces, nodes…</p>
        )}
      </div>
    </div>
  );
}
