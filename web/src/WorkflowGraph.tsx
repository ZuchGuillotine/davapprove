import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { statusTone } from "./WorkflowEvidence";
import type { Assessment } from "./types";
export default function WorkflowGraph({
  assessment, selectedId, onSelect,
}: {
  assessment: Assessment;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const nodes = assessment.nodes.map((n, i) => ({
    id: n.id,
    selected: n.id === selectedId,
    ariaLabel: `${n.title || n.label}: ${n.state || n.status || "unknown"}. Inspect evidence`,
    position: {
      x: i < 4 ? (i % 2) * 280 : 140,
      y: i < 4 ? Math.floor(i / 2) * 140 : 320 + (i - 4) * 140,
    },
    data: {
      label: (
        <>
          <small>
            {n.id} ·{" "}
            {String(n.state || n.status || "unknown").replaceAll("_", " ")}
          </small>
          <strong>{n.title || n.label}</strong>
        </>
      ),
    },
    style: {
      border: n.id === selectedId ? "3px solid #233d39" : "1px solid #8b9c91",
      borderRadius: 12,
      background: { red: "#fde5e5", yellow: "#fff3cd", green: "#e1f3e5" }[statusTone(String(n.state || n.status || "unknown"))],
      width: 235,
      padding: 16,
      color: "#233d39",
    },
  }));
  const edges = assessment.edges.map((e, i) => ({
    id: String(i),
    source: e.source || e.from,
    target: e.target || e.to,
    label: e.type,
    animated: false,
    style: { stroke: "#86a296" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#86a296" },
    labelStyle: { fontSize: 10, fill: "#5c7068" },
  }));
  return (
    <div className="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelect(node.id)}
        onSelectionChange={({ nodes: selected }) => { if (selected[0]) onSelect(selected[0].id); }}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background gap={24} color="#d8e1db" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
