import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import type { Graph } from "../model/graph.ts";

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  r: number;
}

interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

/**
 * Wraps a d3-force simulation. The sim's own timer is stopped; the render
 * loop drives it via `tick()` so drawing and physics stay in lock-step. New
 * nodes spawn near the centre and the sim reheats so the layout settles.
 */
const CENTER_STRENGTH = 0.025;

export class ForceLayout {
  private sim: Simulation<SimNode, undefined>;
  private nodes: SimNode[] = [];
  private byId = new Map<string, SimNode>();
  private linkForce: ReturnType<typeof forceLink<SimNode, SimLink>>;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.linkForce = forceLink<SimNode, SimLink>([])
      .id((n) => n.id)
      .distance(110)
      .strength(0.18);
    this.sim = forceSimulation<SimNode>([])
      .force("charge", forceManyBody().strength(-340).distanceMax(600))
      .force("link", this.linkForce)
      .force("center", forceCenter(width / 2, height / 2).strength(CENTER_STRENGTH))
      .force("collide", forceCollide<SimNode>().radius((n) => n.r + 14).strength(0.9))
      .alphaDecay(0.015)
      .stop();
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sim.force("center", forceCenter(width / 2, height / 2).strength(CENTER_STRENGTH));
  }

  /** Reconcile sim nodes/links with the current graph; reheat on growth. */
  sync(graph: Graph): void {
    let added = false;
    for (const node of graph.nodes.values()) {
      let s = this.byId.get(node.id);
      if (!s) {
        s = {
          id: node.id,
          x: this.width / 2 + (Math.random() - 0.5) * 120,
          y: this.height / 2 + (Math.random() - 0.5) * 120,
          r: node.size,
        };
        this.byId.set(node.id, s);
        this.nodes.push(s);
        added = true;
      } else {
        s.r = node.size;
      }
    }

    const links: SimLink[] = [];
    for (const e of graph.edges.values()) {
      const source = this.byId.get(e.from);
      const target = this.byId.get(e.to);
      if (source && target) links.push({ source, target });
    }

    this.sim.nodes(this.nodes);
    this.linkForce.links(links);
    if (added) this.sim.alpha(Math.max(this.sim.alpha(), 0.6));
  }

  /** Advance the simulation one step, keeping a low warmth for gentle drift. */
  tick(): void {
    if (this.sim.alpha() < 0.015) this.sim.alpha(0.015);
    this.sim.tick();
  }

  position(id: string): SimNode | undefined {
    return this.byId.get(id);
  }
}
