import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
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

const VERDICT_LABELS: Record<string, string> = {
  fabricated: 'Fabricated',
  misused: 'Misused',
  suspect: 'Suspect',
  verified: 'Verified',
  unverifiable: 'Unverifiable',
};

// For argument nodes, verdict encodes survival status:
//   verified   → argument survives (green)
//   fabricated → argument broken (red)
//   unverifiable → unknown
const ARG_STATUS_LABELS: Record<string, string> = {
  verified: 'Argument intact',
  fabricated: 'Argument undermined',
  unverifiable: 'Status unclear',
};

const ARG_STATUS_COLORS: Record<string, string> = {
  verified: '#10b981',    // green
  fabricated: '#ef4444',  // red
  unverifiable: '#94a3b8', // grey
};

function buildFlow(graph: ArgumentGraph, selectedId: string | null) {
  // Separate arguments from citations for a top-down hierarchical layout
  const argNodes = graph.nodes.filter((n) => n.node_type === 'argument');
  const citNodes = graph.nodes.filter((n) => n.node_type === 'citation');

  const argCols = Math.max(1, argNodes.length);
  const citCols = Math.max(1, Math.ceil(citNodes.length / 2));

  const nodeMap = new Map<string, Node>();

  argNodes.forEach((n, i) => {
    const survivalColor = n.verdict
      ? (ARG_STATUS_COLORS[n.verdict] ?? '#1e293b')
      : '#1e293b';
    const statusLabel = n.verdict ? ARG_STATUS_LABELS[n.verdict] : '';

    nodeMap.set(n.id, {
      id: n.id,
      position: { x: i * 240 + 40, y: 40 },
      data: { label: statusLabel ? `${n.label}\n[${statusLabel}]` : n.label },
      style: {
        background: '#1e293b',
        color: '#fff',
        border: selectedId === n.id
          ? '2.5px solid #6366f1'
          : `3px solid ${survivalColor}`,
        borderRadius: '8px',
        fontSize: '11px',
        fontWeight: '600',
        maxWidth: 200,
        padding: '10px 12px',
        whiteSpace: 'pre-wrap' as const,
        boxShadow: n.verdict === 'fabricated'
          ? `0 0 8px rgba(239,68,68,0.4)`
          : selectedId === n.id
          ? '0 0 0 3px rgba(99,102,241,0.3)'
          : undefined,
      },
    });
  });

  citNodes.forEach((n, i) => {
    const col = i % citCols;
    const row = Math.floor(i / citCols);
    const verdictCol = verdictColor(n.verdict as ValidationResult['verdict'] | null);
    const isSelected = selectedId === n.id;

    // Show verdict badge in the label
    const verdictLabel = n.verdict ? ` [${VERDICT_LABELS[n.verdict] ?? n.verdict}]` : '';
    const displayLabel = n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label;

    nodeMap.set(n.id, {
      id: n.id,
      position: {
        x: col * 230 + 40,
        y: 200 + row * 130,
      },
      data: { label: displayLabel + verdictLabel },
      style: {
        background: '#fff',
        color: '#1e293b',
        border: isSelected ? '2.5px solid #6366f1' : `2px solid ${verdictCol}`,
        borderRadius: '6px',
        fontSize: '10px',
        maxWidth: 200,
        padding: '8px 10px',
        boxShadow: isSelected ? '0 0 0 3px rgba(99,102,241,0.3)' : undefined,
      },
    });
  });

  // Fill any nodes that didn't get placed (defensive)
  graph.nodes.forEach((n, i) => {
    if (!nodeMap.has(n.id)) {
      nodeMap.set(n.id, {
        id: n.id,
        position: { x: i * 200 + 40, y: 400 },
        data: { label: n.label },
        style: { background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '10px', padding: '6px' },
      });
    }
  });

  const nodes = Array.from(nodeMap.values());

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    animated: false,
    style: {
      stroke: e.structural ? '#ef4444' : '#94a3b8',
      strokeWidth: e.structural ? 2 : 1,
      strokeDasharray: e.structural ? undefined : '4 3',
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.structural ? '#ef4444' : '#94a3b8' },
    label: e.structural ? 'structural' : undefined,
    labelStyle: { fontSize: 9, fill: '#ef4444' },
  }));

  return { nodes, edges };
}

export function ArgumentDAG({ graph, onNodeClick, selectedId }: Props) {
  const { nodes: initialNodes, edges: initialEdges } = buildFlow(graph, selectedId);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onClickNode = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick(node.id),
    [onNodeClick],
  );

  return (
    <div className="w-full h-full border border-slate-200 overflow-hidden bg-slate-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onClickNode}
        fitView
        minZoom={0.3}
      >
        <Background color="#e2e8f0" gap={20} />
        <Controls />

        <Panel position="top-right">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs space-y-1.5">
            <p className="font-semibold text-slate-700 text-[10px] uppercase tracking-wide mb-1">Legend</p>
            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wide">Arguments</p>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded bg-slate-800 border-2 border-emerald-500 shrink-0" />
              <span className="text-slate-600">Argument intact (verified law)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded bg-slate-800 border-2 border-red-500 shrink-0" />
              <span className="text-slate-600">Argument undermined (unreliable law)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded bg-slate-800 border-2 border-slate-400 shrink-0" />
              <span className="text-slate-600">Argument status unclear</span>
            </div>
            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wide pt-1">Citations</p>
            {(['fabricated', 'misused', 'suspect', 'verified', 'unverifiable'] as const).map((v) => (
              <div key={v} className="flex items-center gap-1.5">
                <div
                  className="w-4 h-4 rounded border-2 shrink-0"
                  style={{ borderColor: verdictColor(v), background: '#fff' }}
                />
                <span className="text-slate-600">{VERDICT_LABELS[v]}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-1 mt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-6 border-t-2 border-red-400 shrink-0" />
                <span className="text-slate-600">Structural dependency</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-6 border-t border-dashed border-slate-400 shrink-0" />
                <span className="text-slate-600">Supporting citation</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 pt-0.5">Click any node for details</p>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
