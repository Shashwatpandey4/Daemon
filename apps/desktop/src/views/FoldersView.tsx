import { FolderOpen } from "lucide-react";

export default function FoldersView() {
  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Folders</h2>
      </div>
      <div className="placeholder-view">
        <FolderOpen size={40} strokeWidth={1} />
        <p>Folders coming soon</p>
      </div>
    </div>
  );
}
