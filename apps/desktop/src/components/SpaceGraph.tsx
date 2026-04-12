import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type OnConnect,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodeCard, type NodeCardData } from "./NodeCard";
import type { SpaceNode, SpaceEdge } from "../views/SpacesView";

const NODE_TYPES = { node: NodeCard };

interface Props {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  onNodeMove: (id: string, x: number, y: number) => void;
  onEdgeAdd: (source: string, target: string) => void;
  onNodeRename: (id: string, title: string) => void;
  onNodeDelete: (id: string) => void;
}

export default function SpaceGraph({ nodes, edges, onNodeMove, onEdgeAdd, onNodeRename, onNodeDelete }: Props) {
  const rfNodes: Node[] = useMemo(() =>
    nodes.map(n => ({
      id: n.id,
      type: "node",
      position: { x: n.pos_x, y: n.pos_y },
      data: {
        title: n.title,
        content: n.content ?? null,
        url: n.url ?? null,
        file_path: n.file_path ?? null,
        node_type: n.node_type ?? "note",
        tags: n.tags ? JSON.parse(n.tags) : [],
        onDelete: onNodeDelete,
        onRename: onNodeRename,
      } satisfies NodeCardData,
    })),
    [nodes, onNodeRename, onNodeDelete]
  );

  const rfEdges: Edge[] = useMemo(() =>
    edges.map(e => ({ id: e.id, source: e.source, target: e.target, type: "smoothstep" })),
    [edges]
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(rfNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setFlowNodes(rfNodes); }, [rfNodes]);
  useEffect(() => { setFlowEdges(rfEdges); }, [rfEdges]);

  const onConnect: OnConnect = useCallback(
    params => {
      setFlowEdges(eds => addEdge({ ...params, type: "smoothstep" }, eds));
      onEdgeAdd(params.source, params.target);
    },
    [onEdgeAdd]
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={NODE_TYPES}
      onNodeDragStop={(_e, node) => onNodeMove(node.id, node.position.x, node.position.y)}
      fitView
      minZoom={0.2}
      maxZoom={2}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2a2a" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor="#7c6fcd"
        maskColor="rgba(0,0,0,0.6)"
        style={{ background: "#161616", border: "1px solid #2a2a2a" }}
      />
    </ReactFlow>
  );
}
