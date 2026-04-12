import { useEffect, useRef } from "react";

export interface CtxItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean; // thin line before this item
}

interface Props {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on any click outside
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Use capture so we beat any stopPropagation in children
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);

  // Adjust to stay within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - items.length * 34 - 16),
    zIndex: 9999,
  };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && i > 0 && <div className="ctx-separator" />}
          <button
            className={`ctx-item${item.danger ? " danger" : ""}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <span className="ctx-icon">{item.icon}</span>}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
