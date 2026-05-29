import type { HoverInfo } from "../graph/ConstellationCanvas.tsx";

export function NodeTooltip({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return null;
  return (
    <div className="node-tooltip" style={{ left: hover.x, top: hover.y }}>
      <span className="node-tooltip-kind">{hover.kind === "builder" ? "builder" : "app"}</span>
      <span className="node-tooltip-text">{hover.text}</span>
    </div>
  );
}
