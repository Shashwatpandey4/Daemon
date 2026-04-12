import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  BackgroundVariant,
  useReactFlow,
  type OnConnect,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as d3 from "d3-force";
import { CircleNode, tagColor } from "./CircleNode";
import type { CircleNodeData } from "./CircleNode";
import { DeletableEdge } from "./DeletableEdge";
import type { SpaceNode, SpaceEdge } from "../views/SpacesView";

const NODE_TYPES = { circle: CircleNode };
const EDGE_TYPES = { deletable: DeletableEdge };

// Calls fitView() whenever `trigger` changes — must be a child of <ReactFlow>
function FitOnSettle({ trigger }: { trigger: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (trigger > 0) fitView({ padding: 0.2, duration: 400 });
  }, [trigger, fitView]);
  return null;
}
const NODE_RADIUS = 40;

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
}

interface Props {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  onNodeMove: (id: string, x: number, y: number) => void;
  onEdgeAdd: (source: string, target: string) => void;
  onEdgeDelete: (id: string) => void;
  onNodeDelete: (id: string) => void;
  onNodeRename: (id: string, title: string) => void;
  onColorChange: (id: string, color: string) => void;
}

function toFlowEdge(e: SpaceEdge, onDelete: (id: string) => void): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "deletable",
    data: { onDelete },
  };
}

export default function SpaceGraph({ nodes, edges, onNodeMove, onEdgeAdd, onEdgeDelete, onNodeDelete, onNodeRename, onColorChange }: Props) {
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [fitTrigger, setFitTrigger] = useState(0);
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const draggingRef = useRef<Set<string>>(new Set());
  // Track which nodes have been positioned by the simulation
  const positionedRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Build flow edges with delete callback
  const edgeDeleteCb = useCallback((id: string) => {
    setFlowEdges(prev => prev.filter(e => e.id !== id));
    onEdgeDelete(id);
  }, [onEdgeDelete]);

  // Run / update d3-force simulation whenever nodes or edges change
  useEffect(() => {
    if (nodes.length === 0) { setFlowNodes([]); setFlowEdges([]); return; }

    // Seed positions: use saved DB positions, fallback to previous sim positions
    const simNodes: SimNode[] = nodes.map(n => {
      const prev = positionedRef.current.get(n.id);
      return {
        id: n.id,
        x: prev?.x ?? n.pos_x ?? (Math.random() * 600 - 300),
        y: prev?.y ?? n.pos_y ?? (Math.random() * 400 - 200),
      };
    });

    const simLinks = edges.map(e => ({ source: e.source, target: e.target }));

    // Kill previous sim
    simRef.current?.stop();

    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force("charge", d3.forceManyBody().strength(-400))
      .force("link", d3.forceLink(simLinks).id((d) => (d as SimNode).id).distance(140).strength(0.6))
      .force("center", d3.forceCenter(0, 0))
      .force("collision", d3.forceCollide(NODE_RADIUS + 20))
      .alphaDecay(0.03)
      .on("tick", () => {
        setFlowNodes(simNodes.map(n => {
          positionedRef.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
          return buildFlowNode(n, nodes, draggingRef, onNodeDelete, onNodeRename, onColorChange);
        }));
      })
      .on("end", () => {
        setFlowNodes(simNodes.map(n => buildFlowNode(n, nodes, draggingRef, onNodeDelete, onNodeRename, onColorChange)));
        setFitTrigger(t => t + 1);
      });

    simRef.current = sim;
    setFlowEdges(edges.map(e => toFlowEdge(e, edgeDeleteCb)));

    return () => { sim.stop(); };
  }, [nodes, edges, edgeDeleteCb, onNodeDelete, onNodeRename]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect: OnConnect = useCallback(params => {
    const newEdge: Edge = { ...params, id: crypto.randomUUID(), type: "deletable", data: { onDelete: edgeDeleteCb } };
    setFlowEdges(eds => addEdge(newEdge, eds));
    onEdgeAdd(params.source, params.target);
  }, [onEdgeAdd, edgeDeleteCb]);

  // On drag: fix node in sim so it doesn't get pushed around
  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    draggingRef.current.add(node.id);
    const simNode = simRef.current?.nodes().find(n => n.id === node.id);
    if (simNode) { simNode.fx = node.position.x; simNode.fy = node.position.y; }
  }, []);

  // On drag stop: save position, release fix
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    draggingRef.current.delete(node.id);
    const simNode = simRef.current?.nodes().find(n => n.id === node.id);
    if (simNode) {
      simNode.fx = node.position.x;
      simNode.fy = node.position.y;
      positionedRef.current.set(node.id, { x: node.position.x, y: node.position.y });
    }
    onNodeMove(node.id, node.position.x, node.position.y);
  }, [onNodeMove]);

  const nodeColor = useCallback((node: Node) => {
    const tags = (node.data as CircleNodeData).tags ?? [];
    return tags.length > 0 ? tagColor(tags[0]) : "#7c6fcd";
  }, []);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      minZoom={0.2}
      maxZoom={2}
      colorMode="dark"
    >
      <FitOnSettle trigger={fitTrigger} />
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2a2a" />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={nodeColor} maskColor="rgba(0,0,0,0.6)" style={{ background: "#161616", border: "1px solid #2a2a2a" }} />
    </ReactFlow>
  );
}

function buildFlowNode(
  n: SimNode,
  sourceNodes: SpaceNode[],
  draggingRef: React.RefObject<Set<string>>,
  onDelete: (id: string) => void,
  onRename: (id: string, title: string) => void,
  onColorChange: (id: string, color: string) => void,
): Node {
  const src = sourceNodes.find(s => s.id === n.id);
  return {
    id: n.id,
    type: "circle",
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    dragging: draggingRef.current?.has(n.id),
    data: {
      title: src?.title ?? "",
      node_type: src?.node_type ?? "note",
      tags: src?.tags ? JSON.parse(src.tags) : [],
      color: src?.color ?? null,
      onDelete,
      onRename,
      onColorChange,
    } satisfies CircleNodeData,
  };
}
