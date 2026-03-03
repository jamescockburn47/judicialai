import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArgumentGraph, ValidationResult } from '../types';
import { verdictColor } from './VerdictBadge';

interface Props {
  graph: ArgumentGraph;
  onNodeClick: (id: string) => void;
  selectedId: string | null;
}

function buildFlow(graph: ArgumentGraph, selectedId: string | null) {
  const nodeCount = graph.nodes.length;
  const cols = Math.ceil(Math.sqrt(nodeCount));

  const nodes: Node[] = graph.nodes.map((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const isArg = n.node_type === 'argument';
    const color = verdictColor(n.verdict as ValidationResult['verdict'] | null);

    return {
      id: n.id,
      position: { x: col * 220 + 40, y: row * 140 + 40 },
      data: { label: n.label },
      style: {
        background: isArg ? '#1e293b' : '#fff',
        color: isArg ? '#fff' : '#1e293b',
        border: selectedId === n.id ? '2.5px solid #6366f1' : `2px solid ${color}`,
        borderRadius: isArg ? '8px' : '6px',
        fontSize: '11px',
        fontWeight: isArg ? '600' : '400',
        maxWidth: 180,
        padding: '8px 10px',
        boxShadow: selectedId === n.id ? '0 0 0 3px rgba(99,102,241,0.3)' : undefined,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    animated: e.structural,
    style: { stroke: e.structural ? '#ef4444' : '#94a3b8', strokeWidth: e.structural ? 2 : 1 },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.structural ? '#ef4444' : '#94a3b8' },
  }));

  return { nodes, edges };
}

export function ArgumentDAG({ graph, onNodeClick, selectedId }: Props) {
  const { nodes: initialNodes, edges: initialEdges } = buildFlow(graph, selectedId);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onClickNode = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className="w-full h-full rounded-lg border border-slate-200 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onClickNode}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
