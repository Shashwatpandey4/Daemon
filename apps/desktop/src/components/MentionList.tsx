import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface MentionItem {
  id: string;
  label: string;
  itemType: "doc" | "whiteboard" | "space";
}

interface Props {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

const MentionList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, Props>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setSelected(0); }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown(e: KeyboardEvent) {
        if (e.key === "ArrowUp") {
          setSelected(s => (s - 1 + items.length) % items.length);
          return true;
        }
        if (e.key === "ArrowDown") {
          setSelected(s => (s + 1) % items.length);
          return true;
        }
        if (e.key === "Enter") {
          if (items[selected]) command(items[selected]);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    const TYPE_CHIP: Record<MentionItem["itemType"], string> = {
      doc: "Doc",
      whiteboard: "Board",
      space: "Space",
    };

    return (
      <div ref={containerRef} className="mention-popup">
        {items.map((item, i) => (
          <div
            key={item.id + item.itemType}
            className={`mention-item${i === selected ? " selected" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={e => { e.preventDefault(); command(item); }}
          >
            <span className="mention-item-label">{item.label}</span>
            <span className="mention-item-type">{TYPE_CHIP[item.itemType]}</span>
          </div>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
export default MentionList;
