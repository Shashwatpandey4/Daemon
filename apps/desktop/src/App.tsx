import { useState } from "react";
import { CheckSquare, Pencil, Boxes, ChevronLeft, ChevronRight } from "lucide-react";
import TodoView from "./views/TodoView";
import WhiteboardView from "./views/WhiteboardView";
import SpacesView from "./views/SpacesView";
import "./App.css";

type View = "todo" | "whiteboard" | "spaces";

const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "todo",       label: "Todo",       icon: <CheckSquare size={18} /> },
  { id: "whiteboard", label: "Whiteboard", icon: <Pencil size={18} /> },
  { id: "spaces",     label: "Spaces",     icon: <Boxes size={18} /> },
];

function renderView(view: View) {
  switch (view) {
    case "todo":       return <TodoView />;
    case "whiteboard": return <WhiteboardView />;
    case "spaces":     return <SpacesView />;
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<View>("todo");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="sidebar-top">
          {!collapsed && <span className="app-title">Daemon</span>}
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              onClick={() => setActiveView(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {renderView(activeView)}
      </main>
    </div>
  );
}
