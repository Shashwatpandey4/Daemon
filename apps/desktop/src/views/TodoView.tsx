import { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { CheckSquare } from "lucide-react";
import ContextMenu, { type CtxItem } from "../components/ContextMenu";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_at: number;
  updated_at: number;
  deleted: boolean;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  return db;
}

interface CtxState { x: number; y: number; items: CtxItem[] }

export default function TodoView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [adding, setAdding] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const db = await getDb();
    const rows = await db.select<Todo[]>(
      "SELECT * FROM todos WHERE deleted = 0 ORDER BY created_at ASC"
    );
    setTodos(rows.map(r => ({ ...r, completed: !!r.completed, deleted: !!r.deleted })));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  async function addTodo(title: string) {
    const t = title.trim();
    if (!t) { setAdding(false); return; }
    const db = await getDb();
    const now = Date.now();
    await db.execute(
      "INSERT INTO todos (id, title, completed, created_at, updated_at, deleted) VALUES (?, ?, 0, ?, ?, 0)",
      [crypto.randomUUID(), t, now, now]
    );
    setAdding(false);
    load();
  }

  async function toggleTodo(id: string, completed: boolean) {
    const db = await getDb();
    await db.execute(
      "UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?",
      [completed ? 0 : 1, Date.now(), id]
    );
    load();
  }

  async function deleteTodo(id: string) {
    const db = await getDb();
    await db.execute(
      "UPDATE todos SET deleted = 1, updated_at = ? WHERE id = ?",
      [Date.now(), id]
    );
    load();
  }

  function onBodyCtx(e: React.MouseEvent) {
    e.preventDefault();
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "New Task", onClick: () => setAdding(true) },
      ],
    });
  }

  function onItemCtx(e: React.MouseEvent, todo: Todo) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: todo.completed ? "Mark Incomplete" : "Mark Complete",
          onClick: () => toggleTodo(todo.id, todo.completed),
        },
        {
          label: "Delete",
          onClick: () => deleteTodo(todo.id),
          danger: true,
          separator: true,
        },
      ],
    });
  }

  const pending = todos.filter(t => !t.completed);
  const done = todos.filter(t => t.completed);

  return (
    <div className="col-view">
      {/* Column header */}
      <div className="col-header">
        <CheckSquare size={14} className="col-header-icon" />
        <span className="col-title">Todo</span>
        {pending.length > 0 && <span className="badge">{pending.length}</span>}
      </div>

      {/* Column body */}
      <div className="col-body" onContextMenu={onBodyCtx}>
        {/* Inline add input */}
        {adding && (
          <div className="todo-add-row">
            <input
              ref={addInputRef}
              className="todo-add-input"
              placeholder="Task name…"
              onKeyDown={e => {
                if (e.key === "Enter") addTodo(e.currentTarget.value);
                if (e.key === "Escape") setAdding(false);
              }}
              onBlur={e => addTodo(e.target.value)}
            />
          </div>
        )}

        {todos.length === 0 && !adding && (
          <p className="empty-state">Right-click to add a task</p>
        )}

        {pending.length > 0 && (
          <ul className="todo-list">
            {pending.map(todo => (
              <li
                key={todo.id}
                className="todo-item"
                onContextMenu={e => onItemCtx(e, todo)}
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleTodo(todo.id, todo.completed)}
                />
                <span className="todo-title">{todo.title}</span>
              </li>
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <>
            <p className="section-label" style={{ padding: "0 16px" }}>Completed</p>
            <ul className="todo-list">
              {done.map(todo => (
                <li
                  key={todo.id}
                  className="todo-item done"
                  onContextMenu={e => onItemCtx(e, todo)}
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleTodo(todo.id, todo.completed)}
                  />
                  <span className="todo-title">{todo.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
