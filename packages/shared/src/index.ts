export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_at: number; // Unix ms
  updated_at: number; // Unix ms
  deleted: boolean;   // soft delete for sync
}

export interface SyncMessage {
  type: "full_sync";
  todos: Todo[];
}
