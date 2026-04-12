import { EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from "@xyflow/react";

interface Props extends EdgeProps {
  data?: { onDelete?: (id: string) => void };
}

export function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data,
}: Props) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: "#444", strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          className="edge-delete-btn"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            className="edge-delete-inner"
            onClick={() => data?.onDelete?.(id)}
            title="Delete connection"
          >×</button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
