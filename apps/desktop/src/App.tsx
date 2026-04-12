import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WhiteboardView from "./views/WhiteboardView";
import SpacesView from "./views/SpacesView";
import NoteView from "./views/NoteView";
import PDFView from "./views/PDFView";
import SearchModal from "./components/SearchModal";
import "./App.css";

export type ActiveView =
  | { type: "whiteboard"; boardId: string }
  | { type: "spaces"; spaceId: string; openAddNode?: boolean }
  | { type: "note"; noteId: string }
  | { type: "pdf"; nodeId: string; filePath: string }
  | null;

export default function App() {
  const [active, setActive] = useState<ActiveView>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleDataChange() {
    setRefreshKey(k => k + 1);
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onActivate={setActive} onDataChange={handleDataChange} />
      <main className="main-area">
        {active?.type === "whiteboard" && (
          <WhiteboardView key={active.boardId} boardId={active.boardId} />
        )}
        {active?.type === "spaces" && (
          <SpacesView
            key={active.spaceId}
            spaceId={active.spaceId}
            refreshKey={refreshKey}
            openAddNode={!!active.openAddNode}
            onAddNodeClose={() => setActive(a => a?.type === "spaces" ? { ...a, openAddNode: false } : a)}
            onNodeOpen={nodeId => setActive({ type: "note", noteId: nodeId })}
            onFileOpen={(nodeId, filePath) => setActive({ type: "pdf", nodeId, filePath })}
          />
        )}
        {active?.type === "note" && (
          <NoteView key={active.noteId} noteId={active.noteId} />
        )}
        {active?.type === "pdf" && (
          <PDFView key={active.nodeId} nodeId={active.nodeId} filePath={active.filePath} />
        )}
        {!active && (
          <div className="placeholder-view">
            <p>Select an item from the sidebar</p>
            <p className="placeholder-hint">Ctrl+K to search</p>
          </div>
        )}
      </main>

      {searchOpen && (
        <SearchModal
          onNavigate={view => { setActive(view); setSearchOpen(false); }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
