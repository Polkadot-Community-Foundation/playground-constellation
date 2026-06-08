// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { isDevAccount } from "../config.ts";
import type { Graph, GraphNode } from "../model/graph.ts";
import { EFFECT_DURATION, type Effect } from "./effects.ts";
import type { ForceLayout } from "./forceLayout.ts";

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

interface Palette {
  core: string;       // bright inner core
  halo: string;       // outer halo color (rgba expected)
  spike: string;      // diffraction-spike gradient mid-stop
}

// Deep Field palette: every node is a luminous star against a near-black sky.
// Pinned roots and high-XP builders carry diffraction spikes so the eye
// finds them across the canvas without needing to be larger discs.
const APP: Palette = {
  core: "#ffc0e0",
  halo: "rgba(255, 130, 190, 0.55)",
  spike: "rgba(255, 180, 220, 0.55)",
};
const BUILDER: Palette = {
  core: "#cfe4ff",
  halo: "rgba(120, 190, 255, 0.55)",
  spike: "rgba(190, 220, 255, 0.6)",
};
const PINNED: Palette = {
  core: "#ffe7a5",
  halo: "rgba(255, 200, 90, 0.7)",
  spike: "rgba(255, 220, 140, 0.85)",
};
// Dev-signer accounts: a muted slate so they're clearly distinct from real
// cyan builders (reads as "ours / system") without disappearing.
const DEV: Palette = {
  core: "#aab4c6",
  halo: "rgba(135, 150, 180, 0.42)",
  spike: "rgba(165, 180, 210, 0.5)",
};

const RECENT_MS = 14000;
const BG_COLOR = "#00010A";

function paletteFor(node: GraphNode): Palette {
  if (node.kind === "builder") return isDevAccount(node.id) ? DEV : BUILDER;
  return node.pinned ? PINNED : APP;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Target viewport that fits all node positions into the canvas with padding.
 * `insetBottom` reserves a band at the bottom (for the ticker) so nodes are
 * fitted into the region *above* it and never render behind the text.
 */
export function computeFit(
  layout: ForceLayout,
  graph: Graph,
  w: number,
  h: number,
  insetBottom = 0,
): Viewport {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const id of graph.nodes.keys()) {
    const p = layout.position(id);
    if (!p) continue;
    count++;
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  if (count === 0) return { scale: 1, tx: 0, ty: 0 };
  const pad = 80;
  const availH = Math.max(1, h - insetBottom);
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min((w - pad * 2) / bw, (availH - pad * 2) / bh, 1.6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { scale, tx: w / 2 - cx * scale, ty: availH / 2 - cy * scale };
}

export function lerpViewport(a: Viewport, b: Viewport, k: number): Viewport {
  return {
    scale: a.scale + (b.scale - a.scale) * k,
    tx: a.tx + (b.tx - a.tx) * k,
    ty: a.ty + (b.ty - a.ty) * k,
  };
}

// -- Background starfield ----------------------------------------------------
//
// A deterministic set of background stars regenerated only when the canvas
// resizes. They twinkle per-frame from a slow phase so the sky reads as a
// real night sky and not a flat fill.

interface BgStar {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

let bgStars: BgStar[] = [];
let bgStarsW = 0;
let bgStarsH = 0;

function ensureStarfield(w: number, h: number): void {
  if (w === bgStarsW && h === bgStarsH && bgStars.length > 0) return;
  bgStarsW = w;
  bgStarsH = h;
  // Density: ~one star per 2400 px². Deterministic seed for stability across
  // re-renders so the sky doesn't flicker on layout changes.
  const count = Math.floor((w * h) / 2400);
  let s = 0xc0ffee;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
  bgStars = [];
  for (let i = 0; i < count; i++) {
    bgStars.push({
      x: rand() * w,
      y: rand() * h,
      r: rand() * 0.9 + 0.2,
      phase: rand() * Math.PI * 2,
      speed: 0.25 + rand() * 1.1,
    });
  }
}

function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  // Layered nebulae — very low alpha so the sky stays near-black.
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);
  const a = ctx.createRadialGradient(w * 0.28, h * 0.32, 0, w * 0.28, h * 0.32, Math.max(w, h));
  a.addColorStop(0, "rgba(80, 50, 180, 0.14)");
  a.addColorStop(0.5, "rgba(80, 50, 180, 0.04)");
  a.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  const b = ctx.createRadialGradient(w * 0.78, h * 0.7, 0, w * 0.78, h * 0.7, Math.max(w, h));
  b.addColorStop(0, "rgba(30, 110, 170, 0.13)");
  b.addColorStop(0.5, "rgba(30, 110, 170, 0.03)");
  b.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, w, h);

  // Twinkling background stars.
  ensureStarfield(w, h);
  ctx.fillStyle = "#ffffff";
  for (const s of bgStars) {
    const a = 0.3 + 0.5 * Math.sin(now * 0.001 * s.speed + s.phase);
    ctx.globalAlpha = Math.max(0, a) * 0.9;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface RenderArgs {
  ctx: CanvasRenderingContext2D;
  graph: Graph;
  layout: ForceLayout;
  effects: Effect[];
  /** Ids to label, precomputed (latest 10) and cached between graph changes. */
  labelIds: Set<string>;
  view: Viewport;
  width: number;
  height: number;
  now: number;
  dpr: number;
}

export function render(args: RenderArgs): void {
  const { ctx, graph, layout, effects, labelIds, view, width, height, now, dpr } = args;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  paintSky(ctx, width, height, now);

  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  drawEdges(ctx, graph, layout);
  drawEffects(ctx, layout, effects, now);
  drawNodes(ctx, graph, layout, view.scale, now, labelIds);

  ctx.restore();
}

/**
 * Ids to label: the 10 most recently-active nodes. Before any activity
 * (cold load), fall back to the pinned roots so the map isn't unlabeled.
 */
export function latestLabelIds(graph: Graph, n: number): Set<string> {
  const active = [...graph.nodes.values()]
    .filter((node) => node.lastActive > 0)
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, n)
    .map((node) => node.id);
  if (active.length > 0) return new Set(active);
  return new Set(
    [...graph.nodes.values()].filter((node) => node.pinned && !node.ghost).map((node) => node.id),
  );
}

// -- Edges ------------------------------------------------------------------
//
// Lineage = the *story* edge (mod descent). Bright mint with a soft glow halo
// and meaningful weight so it reads as a constellation line.
// Ownership = the structural edge (builder → app). Dashed and dimmer so the
// distinction between "this builder owns this app" and "this app descends from
// that one" is unmistakable.

const LINEAGE_STROKE = "rgba(126, 224, 194, 0.92)";
const LINEAGE_GLOW = "rgba(126, 224, 194, 0.22)";
const OWNERSHIP_STROKE = "rgba(160, 195, 240, 0.55)";

function drawEdges(ctx: CanvasRenderingContext2D, graph: Graph, layout: ForceLayout): void {
  // Pass 1: ownership scaffolding (dashed, behind the lineage).
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = OWNERSHIP_STROKE;
  ctx.lineWidth = 1.0;
  for (const e of graph.edges.values()) {
    if (e.kind !== "ownership") continue;
    const a = layout.position(e.from);
    const b = layout.position(e.to);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Pass 2: lineage glow halo (under the bright stroke).
  ctx.strokeStyle = LINEAGE_GLOW;
  ctx.lineWidth = 6;
  for (const e of graph.edges.values()) {
    if (e.kind !== "lineage") continue;
    const a = layout.position(e.from);
    const b = layout.position(e.to);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Pass 3: lineage bright stroke.
  ctx.strokeStyle = LINEAGE_STROKE;
  ctx.lineWidth = 2.6;
  for (const e of graph.edges.values()) {
    if (e.kind !== "lineage") continue;
    const a = layout.position(e.from);
    const b = layout.position(e.to);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// -- Nodes ------------------------------------------------------------------

/**
 * Webb-telescope-style four-point diffraction spikes around the brightest
 * stars. Two crossing gradient lines (horizontal + vertical) plus two
 * shorter diagonals. Drawn behind the node body so the core sits on top.
 */
function diffractionSpikes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  intensity: number,
): void {
  const len = 90 * intensity;
  ctx.save();
  ctx.translate(x, y);
  const draw = (angle: number, alpha: number, length: number) => {
    const grad = ctx.createLinearGradient(-length, 0, length, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = alpha;
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-length, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();
    ctx.rotate(-angle);
  };
  draw(0, 1, len);
  draw(Math.PI / 2, 1, len);
  draw(Math.PI / 4, 0.5, len * 0.55);
  draw(-Math.PI / 4, 0.5, len * 0.55);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  graph: Graph,
  layout: ForceLayout,
  scale: number,
  now: number,
  labelIds: Set<string>,
): void {
  for (const node of graph.nodes.values()) {
    const p = layout.position(node.id);
    if (!p) continue;
    const pal = paletteFor(node);
    const recent = now - node.lastActive < RECENT_MS;
    const alpha = node.ghost ? 0.18 : 1;

    ctx.globalAlpha = alpha;

    // Diffraction spikes: pinned roots always; builders only when sizeable
    // enough to deserve the visual emphasis.
    if (!node.ghost && (node.pinned || (node.kind === "builder" && p.r >= 14))) {
      const intensity = node.pinned ? 1 : 0.65;
      diffractionSpikes(ctx, p.x, p.y, pal.spike, intensity);
    }

    // Halo
    const haloR = p.r * 1.8;
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
    halo.addColorStop(0, "rgba(255,255,255,0.95)");
    halo.addColorStop(0.18, pal.core);
    halo.addColorStop(0.55, pal.halo);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.shadowColor = pal.halo;
    ctx.shadowBlur = recent ? 24 : 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Bright pinpoint core
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, p.r * 0.22), 0, Math.PI * 2);
    ctx.fill();

    if (!node.ghost && labelIds.has(node.id)) {
      const fontPx = Math.max(10, 12 / scale);
      ctx.globalAlpha = alpha * (recent ? 0.95 : 0.7);
      ctx.fillStyle = "rgba(238, 240, 250, 0.85)";
      ctx.font = `${fontPx}px "JetBrains Mono Variable", "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(node.label, p.x, p.y + p.r + fontPx + 6);
    }
    ctx.globalAlpha = 1;
  }
}

// -- Effects (transient animations) -----------------------------------------
//
// `birth` and `pulse` are simple expanding rings as before.
// `star` and `lineage` get full comet anatomy:
//   - cubic Bezier arc path (so it doesn't look like a straight rail)
//   - tapered tail sampled back along the curve
//   - sparkle particles spawned along the trail that drift and fade
// Sparkle particle pools live in a Map keyed by effect identity so they
// persist across render frames without leaking past the effect's lifetime.

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
}

const sparkleStores = new WeakMap<Effect, Sparkle[]>();

function cubic(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

interface Curve {
  x0: number; y0: number;
  c1x: number; c1y: number;
  c2x: number; c2y: number;
  x1: number; y1: number;
}

function bezier(ax: number, ay: number, bx: number, by: number): Curve {
  const dx = bx - ax;
  const dy = by - ay;
  // Perpendicular offset for the arc; sign deterministic from endpoints so
  // it doesn't flicker.
  const sign = ((ax + bx + ay + by) | 0) % 2 === 0 ? 1 : -1;
  const px = -dy * 0.22 * sign;
  const py = dx * 0.22 * sign;
  return {
    x0: ax, y0: ay,
    c1x: ax + dx * 0.25 + px, c1y: ay + dy * 0.25 + py,
    c2x: ax + dx * 0.75 + px, c2y: ay + dy * 0.75 + py,
    x1: bx, y1: by,
  };
}

function pointOn(c: Curve, t: number): { x: number; y: number } {
  return {
    x: cubic(t, c.x0, c.c1x, c.c2x, c.x1),
    y: cubic(t, c.y0, c.c1y, c.c2y, c.y1),
  };
}

interface CometStyle {
  tail: string;        // rgba prefix-style: "rgba(r,g,b,"
  head: string;        // hex
  headHalo: string;
  shadow: string;
}

const STAR_STYLE: CometStyle = {
  tail: "rgba(190, 235, 255,",
  head: "#ffffff",
  headHalo: "rgba(190, 235, 255, 0.9)",
  shadow: "rgba(190, 235, 255, 0.8)",
};
const LINEAGE_STYLE: CometStyle = {
  tail: "rgba(126, 224, 194,",
  head: "#e0fff3",
  headHalo: "rgba(126, 224, 194, 0.9)",
  shadow: "rgba(126, 224, 194, 0.8)",
};
// Warm gold for highlight + ambient comets — reads as distinct from the
// white-cyan (star) and mint (lineage) comets fired by real on-chain events,
// matching the pinned-tutorial gold elsewhere in the palette.
const GOLD_STYLE: CometStyle = {
  tail: "rgba(255, 209, 120,",
  head: "#fff6e0",
  headHalo: "rgba(255, 209, 120, 0.9)",
  shadow: "rgba(255, 199, 90, 0.8)",
};

// `scale` shrinks the whole comet (head + tail + sparkles) and `alphaMul`
// dims it, so ambient drifts read as fainter/smaller than live-event comets
// without duplicating the drawing code.
function drawComet(
  ctx: CanvasRenderingContext2D,
  curve: Curve,
  t: number,
  style: CometStyle,
  fx: Effect,
  scale = 1,
  alphaMul = 1,
): void {
  const head = pointOn(curve, t);

  // Tail: sample backwards along the curve and draw short anti-aliased
  // segments with tapering width and alpha.
  const SAMPLES = 30;
  for (let i = 0; i < SAMPLES; i++) {
    const tt = Math.max(0, t - (i + 1) * 0.012);
    if (tt <= 0) break;
    const a = pointOn(curve, tt);
    const b = pointOn(curve, Math.max(0, tt - 0.012));
    const alpha = (1 - i / SAMPLES) * 0.55 * (1 - t * 0.3) * alphaMul;
    const w = Math.max(0.4, 3.6 * scale * (1 - i / SAMPLES));
    ctx.strokeStyle = `${style.tail}${alpha.toFixed(3)})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();
  }

  // Sparkle particles: spawn along the trail, then drift+fade.
  let sparkles = sparkleStores.get(fx);
  if (!sparkles) {
    sparkles = [];
    sparkleStores.set(fx, sparkles);
  }
  if (t < 0.95 && Math.random() < 0.88) {
    sparkles.push({
      x: head.x + (Math.random() - 0.5) * 4 * scale,
      y: head.y + (Math.random() - 0.5) * 4 * scale,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      life: 1,
      decay: 0.012 + Math.random() * 0.02,
      size: (0.6 + Math.random() * 1.5) * scale,
    });
  }
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const p = sparkles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) {
      sparkles.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(255,255,255,${(p.life * 0.9 * alphaMul).toFixed(3)})`;
    ctx.shadowColor = style.shadow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Head: bright pinpoint with a soft halo.
  const haloR = 14 * scale;
  ctx.globalAlpha = alphaMul;
  const headGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, haloR);
  headGrad.addColorStop(0, "#ffffff");
  headGrad.addColorStop(0.3, style.headHalo);
  headGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(head.x, head.y, haloR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = style.head;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 2.4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawEffects(
  ctx: CanvasRenderingContext2D,
  layout: ForceLayout,
  effects: Effect[],
  now: number,
): void {
  for (const fx of effects) {
    const t = (now - fx.start) / EFFECT_DURATION[fx.type];
    if (t < 0 || t > 1) continue;
    if (fx.type === "birth" || fx.type === "pulse") {
      const p = layout.position(fx.nodeId);
      if (!p) continue;
      const radius = p.r + easeOut(t) * (fx.type === "birth" ? 52 : 32);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = fx.type === "birth" ? "#ffffff" : "rgba(190, 235, 255, 0.95)";
      ctx.lineWidth = fx.type === "birth" ? 2.2 : 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      const a = layout.position(fx.from);
      const b = layout.position(fx.to);
      if (!a || !b) continue;
      const curve = bezier(a.x, a.y, b.x, b.y);
      // Real on-chain events: white-cyan (star) / mint (lineage), full size.
      // Highlights + ambient drift: gold, shrunk and dimmed so they read as
      // "alive but not a fresh event".
      if (fx.type === "highlightStar") {
        drawComet(ctx, curve, t, GOLD_STYLE, fx, 0.85, 0.9);
      } else if (fx.type === "ambientStar") {
        drawComet(ctx, curve, t, GOLD_STYLE, fx, 0.6, 0.6);
      } else {
        drawComet(ctx, curve, t, fx.type === "lineage" ? LINEAGE_STYLE : STAR_STYLE, fx);
      }
    }
  }
}