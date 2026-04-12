import { useEffect, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { Plus, Trash2 } from "lucide-react";

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

export default function TodoView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");

  async function load() {
    const db = await getDb();
    const rows = await db.select<Todo[]>(
      "SELECT * FROM todos WHERE deleted = 0 ORDER BY created_at ASC"
    );
    setTodos(rows.map(r => ({ ...r, completed: !!r.completed, deleted: !!r.deleted })));
  }

  useEffect(() => { load(); }, []);

  async function addTodo() {
    if (!input.trim()) return;
    const db = await getDb();
    const now = Date.now();
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: input.trim(),
      completed: false,
      created_at: now,
      updated_at: now,
      deleted: false,
    };
    await db.execute(
      "INSERT INTO todos (id, title, completed, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)",
      [todo.id, todo.title, 0, todo.created_at, todo.updated_at, 0]
    );
    setInput("");
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

  const pending = todos.filter(t => !t.completed);
  const done = todos.filter(t => t.completed);

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Todo</h2>
        <span className="badge">{pending.length} remaining</span>
      </div>

      <div className="todo-input-row">
        <input
          className="todo-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTodo()}
          placeholder="New task..."
        />
        <button className="btn-primary icon-btn" onClick={addTodo} title="Add">
          <Plus size={16} />
        </button>
      </div>

      {todos.length === 0 && (
        <p className="empty-state">No tasks yet. Add one above.</p>
      )}

      {pending.length > 0 && (
        <ul className="todo-list">
          {pending.map(todo => (
            <li key={todo.id} className="todo-item">
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggleTodo(todo.id, todo.completed)}
              />
              <span className="todo-title">{todo.title}</span>
              <button className="icon-btn ghost" onClick={() => deleteTodo(todo.id)} title="Delete">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <p className="section-label">Completed</p>
          <ul className="todo-list">
            {done.map(todo => (
              <li key={todo.id} className="todo-item done">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggleTodo(todo.id, todo.completed)}
                />
                <span className="todo-title">{todo.title}</span>
                <button className="icon-btn ghost" onClick={() => deleteTodo(todo.id)} title="Delete">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
