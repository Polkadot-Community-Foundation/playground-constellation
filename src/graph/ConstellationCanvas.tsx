import { useEffect, useRef, type RefObject } from "react";
import { shortAddr, type Graph, type GraphNode } from "../model/graph.ts";
import type { Effect } from "./effects.ts";
import { pruneEffects } from "./effects.ts";
import { ForceLayout } from "./forceLayout.ts";
import { computeFit, latestLabelIds, lerpViewport, render, type Viewport } from "./render.ts";

const LABEL_COUNT = 10;

export interface HoverInfo {
  text: string;
  kind: GraphNode["kind"];
  x: number;
  y: number;
}

interface Props {
  graphRef: RefObject<Graph>;
  effectsRef: RefObject<Effect[]>;
  versionRef: RefObject<number>;
  onHover: (info: HoverInfo | null) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** What to show on hover: app domain, builder username, or full address. */
function hoverText(node: GraphNode): string {
  if (node.kind === "builder") {
    return node.label === shortAddr(node.id) ? node.id : node.label;
  }
  return node.label;
}

export function ConstellationCanvas({ graphRef, effectsRef, versionRef, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const layout = new ForceLayout(width, height);
    let view: Viewport = { scale: 1, tx: 0, ty: 0 };
    let lastVersion = -1;
    let labelIds = new Set<string>();
    let raf = 0;

    // User control: while `manual`, auto-fit is paused and the user drives view.
    let manual = false;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      layout.setSize(width, height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      manual = true;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
      // Keep the world point under the cursor fixed while zooming.
      view.tx = mx - ((mx - view.tx) * newScale) / view.scale;
      view.ty = my - ((my - view.ty) * newScale) / view.scale;
      view.scale = newScale;
    };
    // Find the node under a canvas-relative point, if any (closest within radius).
    const hitTest = (mx: number, my: number): GraphNode | null => {
      const graph = graphRef.current;
      if (!graph) return null;
      const wx = (mx - view.tx) / view.scale;
      const wy = (my - view.ty) / view.scale;
      const tol = 4 / view.scale;
      let best: GraphNode | null = null;
      let bestDist = Infinity;
      for (const node of graph.nodes.values()) {
        const p = layout.position(node.id);
        if (!p) continue;
        const d = Math.hypot(wx - p.x, wy - p.y);
        if (d <= p.r + tol && d < bestDist) {
          bestDist = d;
          best = node;
        }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      manual = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      onHover(null);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) {
        view.tx += e.clientX - lastX;
        view.ty += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTest(mx, my);
      canvas.style.cursor = node ? "pointer" : "grab";
      onHover(node ? { text: hoverText(node), kind: node.kind, x: mx, y: my } : null);
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = "grab";
    };
    const onPointerLeave = () => onHover(null);
    const reset = () => {
      manual = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "0") reset();
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", reset);
    window.addEventListener("keydown", onKey);

    const frame = () => {
      const now = Date.now();
      const graph = graphRef.current;
      if (graph) {
        if (versionRef.current !== lastVersion) {
          layout.sync(graph);
          labelIds = latestLabelIds(graph, LABEL_COUNT);
          lastVersion = versionRef.current ?? 0;
        }
        layout.tick();
        if (!manual) {
          // Reserve a bottom band for the headline so nodes stay above it.
          const insetBottom = Math.min(height * 0.26, 200);
          const target = computeFit(layout, graph, width, height, insetBottom);
          view = lerpViewport(view, target, 0.05);
        }
        if (effectsRef.current) {
          const pruned = pruneEffects(effectsRef.current, now);
          effectsRef.current.length = 0;
          effectsRef.current.push(...pruned);
        }
        render({
          ctx,
          graph,
          layout,
          effects: effectsRef.current ?? [],
          labelIds,
          view,
          width,
          height,
          now,
          dpr,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", reset);
      window.removeEventListener("keydown", onKey);
    };
  }, [graphRef, effectsRef, versionRef, onHover]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
