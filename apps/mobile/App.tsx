import { useEffect, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SQLite from "expo-sqlite";
import type { Todo } from "@daemon/shared";

let db: SQLite.SQLiteDatabase | null = null;

async function getDb() {
  if (!db) {
    db = await SQLite.openDatabaseAsync("daemon.db");
    await db.execAsync(`
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

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");

  async function load() {
    const db = await getDb();
    const rows = await db.getAllAsync<Todo>(
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
      id: uuid(),
      title: input.trim(),
      completed: false,
      created_at: now,
      updated_at: now,
      deleted: false,
    };
    await db.runAsync(
      "INSERT INTO todos (id, title, completed, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)",
      [todo.id, todo.title, 0, todo.created_at, todo.updated_at, 0]
    );
    setInput("");
    load();
  }

  async function toggleTodo(id: string, completed: boolean) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?",
      [completed ? 0 : 1, Date.now(), id]
    );
    load();
  }

  async function deleteTodo(id: string) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE todos SET deleted = 1, updated_at = ? WHERE id = ?",
      [Date.now(), id]
    );
    load();
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.heading}>Daemon</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={addTodo}
            placeholder="Add a todo..."
            placeholderTextColor="#555"
            returnKeyType="done"
          />
          <Pressable style={styles.addBtn} onPress={addTodo}>
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        <FlatList
          data={todos}
          keyExtractor={item => item.id}
          style={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No todos yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Pressable onPress={() => toggleTodo(item.id, item.completed)} style={styles.check}>
                <Text style={styles.checkText}>{item.completed ? "✓" : "○"}</Text>
              </Pressable>
              <Text style={[styles.title, item.completed && styles.done]}>{item.title}</Text>
              <Pressable onPress={() => deleteTodo(item.id)}>
                <Text style={styles.del}>✕</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f0f0f" },
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20 },
  heading: { fontSize: 32, fontWeight: "700", color: "#fff", marginBottom: 24 },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  input: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
    color: "#e0e0e0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  addBtn: {
    backgroundColor: "#3b82f6",
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  list: { flex: 1 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12,
  },
  check: { width: 24 },
  checkText: { color: "#3b82f6", fontSize: 16, fontWeight: "700" },
  title: { flex: 1, color: "#e0e0e0", fontSize: 15 },
  done: { textDecorationLine: "line-through", color: "#666" },
  del: { color: "#555", fontSize: 14 },
  empty: { color: "#555", textAlign: "center", marginTop: 40 },
});
