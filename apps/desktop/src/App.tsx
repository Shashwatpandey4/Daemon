import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WhiteboardView from "./views/WhiteboardView";
import SpacesView from "./views/SpacesView";
import NoteView from "./views/NoteView";
import PDFView from "./views/PDFView";
import TextFileView from "./views/TextFileView";
import CalendarView from "./views/CalendarView";
import GlobalGraphView from "./views/GlobalGraphView";
import SearchModal from "./components/SearchModal";
import ArxivImportModal from "./components/ArxivImportModal";
import "./App.css";

export type ActiveView =
  | { type: "whiteboard"; boardId: string }
  | { type: "spaces"; spaceId: string; openAddNode?: boolean }
  | { type: "note"; noteId: string }
  | { type: "pdf"; nodeId: string; filePath: string }
  | { type: "textfile"; filePath: string }
  | { type: "calendar" }
  | { type: "global-graph" }
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [arxivOpen, setArxivOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onActivate={setActive}
        onDataChange={handleDataChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        onArxivImport={() => setArxivOpen(true)}
      />
      <main className="main-area">
        {active?.type === "whiteboard" && (
          <WhiteboardView key={active.boardId} boardId={active.boardId} onNavigate={setActive} />
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
          <NoteView key={active.noteId} noteId={active.noteId} onNavigate={setActive} />
        )}
        {active?.type === "pdf" && (
          <PDFView key={active.nodeId} nodeId={active.nodeId} filePath={active.filePath} onNavigate={setActive} />
        )}
        {active?.type === "textfile" && (
          <TextFileView key={active.filePath} filePath={active.filePath} />
        )}
        {active?.type === "calendar" && (
          <CalendarView />
        )}
        {active?.type === "global-graph" && (
          <GlobalGraphView onNavigate={setActive} />
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

      {arxivOpen && (
        <ArxivImportModal
          onClose={() => setArxivOpen(false)}
          onNavigate={view => { setActive(view); }}
        />
      )}
    </div>
  );
}
