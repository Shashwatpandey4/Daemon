import { useState } from "react";
import Sidebar from "./components/Sidebar";
import WhiteboardView from "./views/WhiteboardView";
import SpacesView from "./views/SpacesView";
import "./App.css";

export type ActiveView =
  | { type: "whiteboard"; boardId: string }
  | { type: "spaces"; spaceId: string; openAddNode?: boolean }
  | null;

export default function App() {
  const [active, setActive] = useState<ActiveView>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleActivate(view: ActiveView) {
    // If re-selecting the same space with openAddNode, just toggle the flag
    setActive(view);
  }

  function handleDataChange() {
    setRefreshKey(k => k + 1);
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onActivate={handleActivate} onDataChange={handleDataChange} />
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
          />
        )}
        {!active && (
          <div className="placeholder-view">
            <p>Select an item from the sidebar</p>
          </div>
        )}
      </main>
    </div>
  );
}
