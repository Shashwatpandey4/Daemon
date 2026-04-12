import { Pencil } from "lucide-react";

export default function WhiteboardView() {
  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Whiteboard</h2>
      </div>
      <div className="placeholder-view">
        <Pencil size={40} strokeWidth={1} />
        <p>Whiteboard coming soon</p>
      </div>
    </div>
  );
}
