import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Assessment } from "./types";
export default function WorkflowGraph({
  assessment,
}: {
  assessment: Assessment;
}) {
  const nodes = assessment.nodes.map((n, i) => ({
    id: n.id,
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
      border: "1px solid #cbd8d0",
      borderRadius: 12,
      background: "#fff",
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
