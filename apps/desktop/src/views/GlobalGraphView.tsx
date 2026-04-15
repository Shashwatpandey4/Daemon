import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  useReactFlow,
  type Node, type Edge, type EdgeProps,
  type NodeChange, type EdgeChange,
  applyNodeChanges, applyEdgeChanges,
  Handle, Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as d3 from "d3-force";
import Database from "@tauri-apps/plugin-sql";
import { CircleNode, PALETTE } from "../components/CircleNode";
import type { ActiveView } from "../App";

// ── DB ────────────────────────────────────────────────────────────────────────

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

interface DBSpace   { id: string; name: string; }
interface DBNode    { id: string; space_id: string; title: string; node_type: string; file_path: string | null; tags: string | null; color: string | null; pos_x: number; pos_y: number; }
interface DBEdge    { id: string; space_id: string; source: string; target: string; }

// ── Space hub node component ──────────────────────────────────────────────────

interface HubData { label: string; color: string; onOpen: () => void; [key: string]: unknown; }

function SpaceHubNode({ data }: { data: HubData }) {
  return (
    <div
      className="space-hub-node"
      style={{ "--hub-color": data.color } as React.CSSProperties}
      onClick={data.onOpen}
      title={`Open ${data.label}`}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} />
      <span className="space-hub-label">{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

// ── Radial edge — center-to-center, trimmed at node circumference ────────────

function RadialEdge({ id, source, target, style, data }: EdgeProps) {
  const { getNode } = useReactFlow();
  const sNode = getNode(source);
  const tNode = getNode(target);
  if (!sNode || !tNode) return null;

  const sw = sNode.measured?.width  ?? sNode.width  ?? 80;
  const sh = sNode.measured?.height ?? sNode.height ?? 80;
  const tw = tNode.measured?.width  ?? tNode.width  ?? 80;
  const th = tNode.measured?.height ?? tNode.height ?? 80;

  // Node centers in flow coordinates
  const sx = sNode.position.x + sw / 2;
  const sy = sNode.position.y + sh / 2;
  const tx = tNode.position.x + tw / 2;
  const ty = tNode.position.y + th / 2;

  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;

  const ux = dx / len, uy = dy / len;
  // Trim at the visual circle radius of each node
  const sR = Math.min(sw, sh) / 2;
  const tR = Math.min(tw, th) / 2;

  const x1 = sx + ux * sR;
  const y1 = sy + uy * sR;
  const x2 = tx - ux * tR;
  const y2 = ty - uy * tR;

  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      strokeLinecap="round"
      style={style as React.CSSProperties}
    />
  );
}

// ── Sim ───────────────────────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string; hubId?: string; isHub?: boolean;
}

const NODE_TYPES = { circle: CircleNode, hub: SpaceHubNode };
const EDGE_TYPES = { radial: RadialEdge };

function FitOnSettle({ trigger }: { trigger: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => { if (trigger > 0) fitView({ padding: 0.15, duration: 500 }); }, [trigger, fitView]);
  return null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props { onNavigate: (v: ActiveView) => void; }

export default function GlobalGraphView({ onNavigate }: Props) {
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [fitTrigger, setFitTrigger] = useState(0);
  const simRef  = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const posRef  = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragging = useRef<Set<string>>(new Set());

  // Store raw data for rebuilding flow nodes during sim ticks
  const spacesRef = useRef<DBSpace[]>([]);
  const nodesRef  = useRef<DBNode[]>([]);
  const edgesRef  = useRef<DBEdge[]>([]);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [spaces, nodes, edges] = await Promise.all([
        db.select<DBSpace[]>("SELECT id, name FROM spaces ORDER BY created_at ASC"),
        db.select<DBNode[]>("SELECT id, space_id, title, node_type, file_path, tags, color, pos_x, pos_y FROM space_nodes ORDER BY created_at ASC"),
        db.select<DBEdge[]>("SELECT id, space_id, source, target FROM space_edges"),
      ]);
      spacesRef.current = spaces;
      nodesRef.current  = nodes;
      edgesRef.current  = edges;
      buildSim(spaces, nodes, edges);
    })();
    return () => { simRef.current?.stop(); };
  }, []);

  function buildSim(spaces: DBSpace[], nodes: DBNode[], edges: DBEdge[]) {
    simRef.current?.stop();

    const n = spaces.length;
    const RING_R = Math.max(300, n * 120);

    // Hub sim-nodes arranged in a ring
    const hubNodes: SimNode[] = spaces.map((s, i) => {
      const angle = (i / n) * 2 * Math.PI;
      const prev = posRef.current.get(`hub-${s.id}`);
      return {
        id: `hub-${s.id}`,
        isHub: true,
        x: prev?.x ?? Math.cos(angle) * RING_R,
        y: prev?.y ?? Math.sin(angle) * RING_R,
      };
    });

    // Member sim-nodes, seeded near their hub
    const memberNodes: SimNode[] = nodes.map(nd => {
      const hubIdx = spaces.findIndex(s => s.id === nd.space_id);
      const angle = hubIdx >= 0 ? (hubIdx / n) * 2 * Math.PI : 0;
      const prev = posRef.current.get(nd.id);
      return {
        id: nd.id,
        hubId: `hub-${nd.space_id}`,
        x: prev?.x ?? (Math.cos(angle) * RING_R + (Math.random() - 0.5) * 120),
        y: prev?.y ?? (Math.sin(angle) * RING_R + (Math.random() - 0.5) * 120),
      };
    });

    const allSimNodes = [...hubNodes, ...memberNodes];

    // Persisted space_edges + synthetic cluster links (hub → member)
    const clusterLinks = memberNodes.map(mn => ({
      source: mn.hubId!, target: mn.id, cluster: true,
    }));
    const persistedLinks = edges.map(e => ({
      source: e.source, target: e.target, cluster: false,
    }));
    const allLinks = [...clusterLinks, ...persistedLinks];

    const sim = d3.forceSimulation<SimNode>(allSimNodes)
      .force("charge", d3.forceManyBody().strength(n => (n as SimNode).isHub ? -1200 : -300))
      .force("link",
        d3.forceLink<SimNode, { source: string; target: string; cluster: boolean }>(allLinks)
          .id(d => d.id)
          .distance(l => l.cluster ? 110 : 140)
          .strength(l => l.cluster ? 0.8 : 0.5)
      )
      .force("center", d3.forceCenter(0, 0).strength(0.05))
      .force("collision", d3.forceCollide((n: SimNode) => n.isHub ? 90 : 45))
      .alphaDecay(0.025)
      .on("tick", () => {
        allSimNodes.forEach(n => posRef.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }));
        setFlowNodes(buildFlowNodes(allSimNodes, spaces, nodes, dragging, onNavigate));
      })
      .on("end", () => {
        setFlowNodes(buildFlowNodes(allSimNodes, spaces, nodes, dragging, onNavigate));
        setFitTrigger(t => t + 1);
      });

    simRef.current = sim;

    // Cluster edges (hub → member) — radial straight lines trimmed at circumference
    const clusterFlowEdges: Edge[] = memberNodes.map(mn => ({
      id: `cluster-${mn.id}`,
      source: mn.hubId!,
      target: mn.id,
      type: "radial",
      style: { stroke: "#ffffff", strokeWidth: 1, opacity: 0.35 },
      animated: false,
      selectable: false,
      focusable: false,
    }));

    // Persisted space_edges rendered normally
    const persistedFlowEdges: Edge[] = edges.map(e => ({
      id: e.id, source: e.source, target: e.target,
      type: "radial",
      style: { stroke: "#ffffff", strokeWidth: 1.5, opacity: 0.85 },
    }));

    setFlowEdges([...clusterFlowEdges, ...persistedFlowEdges]);
  }

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes(nds => applyNodeChanges(changes, nds));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    dragging.current.add(node.id);
    const sn = simRef.current?.nodes().find(n => n.id === node.id);
    if (sn) { sn.fx = node.position.x; sn.fy = node.position.y; }
  }, []);
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    dragging.current.delete(node.id);
    const sn = simRef.current?.nodes().find(n => n.id === node.id);
    if (sn) { sn.fx = node.position.x; sn.fy = node.position.y; posRef.current.set(node.id, { x: node.position.x, y: node.position.y }); }
  }, []);

  const miniMapColor = useCallback((node: Node) => {
    if (node.type === "hub") return (node.data as HubData).color;
    return "#555";
  }, []);

  return (
    <ReactFlow
      nodes={flowNodes} edges={flowEdges}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
      nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
      minZoom={0.1} maxZoom={2} colorMode="dark"
    >
      <FitOnSettle trigger={fitTrigger} />
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2a2a" />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={miniMapColor} maskColor="rgba(0,0,0,0.6)"
        style={{ background: "#161616", border: "1px solid #2a2a2a" }} />
    </ReactFlow>
  );
}

// ── Build ReactFlow nodes from sim positions ──────────────────────────────────

function buildFlowNodes(
  simNodes: SimNode[],
  spaces: DBSpace[],
  dbNodes: DBNode[],
  dragging: React.RefObject<Set<string>>,
  onNavigate: (v: ActiveView) => void,
): Node[] {
  return simNodes.map((sn, i) => {
    if (sn.isHub) {
      const space = spaces.find(s => `hub-${s.id}` === sn.id)!;
      const color = PALETTE[i % PALETTE.length];
      return {
        id: sn.id,
        type: "hub",
        position: { x: sn.x ?? 0, y: sn.y ?? 0 },
        dragging: dragging.current?.has(sn.id),
        data: {
          label: space?.name ?? "",
          color,
          onOpen: () => onNavigate({ type: "spaces", spaceId: space.id }),
        } satisfies HubData,
      };
    }
    const nd = dbNodes.find(n => n.id === sn.id)!;
    // Derive color from parent space
    const spaceIdx = spaces.findIndex(s => s.id === nd?.space_id);
    const spaceColor = spaceIdx >= 0 ? PALETTE[spaceIdx % PALETTE.length] : null;
    return {
      id: sn.id,
      type: "circle",
      position: { x: sn.x ?? 0, y: sn.y ?? 0 },
      dragging: dragging.current?.has(sn.id),
      data: {
        title: nd?.title ?? "",
        node_type: nd?.node_type ?? "note",
        file_path: nd?.file_path ?? null,
        tags: nd?.tags ? JSON.parse(nd.tags) : [],
        color: nd?.color ?? spaceColor,
        onDelete: () => {},
        onRename: () => {},
        onColorChange: () => {},
        onOpen: () => {},
        onFileOpen: () => {},
      },
    };
  });
}
