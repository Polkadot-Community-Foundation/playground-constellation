> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.


# playground-constellation

A live big-screen constellation of Polkadot Playground activity for the Web3 Summit Developer Lab. Visualizes every deploy, mod, and star on the registry contract as a force-directed star map — pinned tutorials anchor the sky, builder nodes orbit their apps, mod descent forms constellation lines, and each new event arcs across the canvas as a shooting star with a sparkling tail.

Designed to run as a kiosk inside Polkadot Desktop for days at a time.

## Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/`. Without a host or a chain configured, the app falls back to synthetic mock data so the UI is always something to look at in dev.

## Modes

The data source is picked at runtime by [`src/chain/select.ts`](src/chain/select.ts):

| When | Source | Mode |
|---|---|---|
| `?demo=1` in the URL (or `VITE_USE_DEMO=1`) | Scripted summit-demo data (~32 nodes, 6 clusters, ~90s event loop) | `demo` |
| `VITE_USE_MOCK=1` | Synthetic random-roll mock | `mock` |
| `VITE_USE_DIRECT=1` | Real chain via direct WS to Paseo Asset Hub | `live` |
| Running inside Polkadot Desktop | Real chain, host-routed (production) | `live` |
| Plain dev browser (no flags) | Mock fallback | `mock` |

Demo mode reports as a distinct `demo` mode so it never contaminates the live cache — handy for recording video against a redeployed (empty) registry. To remove the demo entirely once the network is back, delete `src/demo/` and revert the demo branch in `select.ts`.

## What you see on the screen

- **Top bar** — running totals (apps, stars) and a `LIVE` indicator once the cold-load snapshot resolves.
- **Constellation** — pinned tutorials in gold with Webb-style four-point diffraction spikes, top builders in cyan, apps in pink. Edges are dashed slate for ownership (builder → app) and solid mint for lineage (source → child mod). Recently-active nodes glow more brightly.
- **Shooting stars** — every `star` and `mod` event traces a Bezier arc from the actor to the target with a tapered comet tail and sparkle particles drifting and fading along the path.
- **Headline** — Fraunces serif headline in the lower third updates with every event ("alice just modded the-ballot.dot · +1 XP"). During quiet stretches the highlights source surfaces leaderboard pulses ("alice leads · 412 XP").
- **Event feed** — right-hand column with `HH:MM:SS [TAG] actor → target +xp` rows, fading in newest-first.

## Architecture

```
src/
├── App.tsx                  # state + snapshot bootstrap + handler wiring
├── chain/
│   ├── select.ts            # picks primary + auxiliary sources by env / URL
│   ├── source.ts            # ConstellationSource + Handlers + event types
│   ├── liveSource.ts        # primary live source (snapshot + subscribe)
│   ├── reads.ts             # paged registry reads for the cold snapshot
│   ├── live.ts              # ContractEmitted subscription + decode pipeline
│   ├── events.ts            # registry event name ↔ keccak topic registry
│   ├── decode.ts            # SCALE decode for typed payloads (point / star / mod)
│   ├── dedup.ts             # collapses a deploy's event burst into one LogicalEvent
│   ├── highlights.ts        # auxiliary source: polls registry every 60s
│   ├── mock.ts              # synthetic random-roll fallback
│   ├── cache.ts             # localStorage snapshot+feed cache (live scope only)
│   └── ...
├── demo/                    # scripted summit-demo data (drop entire folder to remove)
├── model/
│   ├── graph.ts             # nodes, edges, applyEvent/applySnapshot, sizing, prune
│   └── format.ts            # FeedLine rendering + headline strings
├── graph/
│   ├── ConstellationCanvas.tsx  # canvas mount, pan/zoom, animation loop
│   ├── forceLayout.ts       # d3-force wrapper
│   ├── render.ts            # Deep Field rendering (starfield, spikes, comet tails)
│   └── effects.ts           # transient animations (birth, pulse, star, lineage)
├── ui/                      # TopStrip, Headline, EventFeed, Legend, NodeTooltip, ...
├── styles/theme.css         # Deep Field palette, Fraunces + JetBrains Mono
└── config.ts                # MAX_NODES, registry package name, XP constants
```

### Multi-source composition

`selectSources()` returns a primary (snapshot + live events) plus zero or more auxiliary sources (currently just `registry-highlights`). All sources funnel through one handler bag:

- `onEvent` — graph-mutating logical events (`deploy` / `mod` / `star` / etc.)
- `onRelabel` — builder username changes (from `UsernameSet` / `UsernameCleared`)
- `onHighlight` — display-only insights (top builder, recent publishes, app count)

This makes it cheap to add new sources later (e.g. a Bulletin feed, an external announcements channel) without touching the canvas or the reducer.

### Pruning

The graph is capped at `MAX_NODES = 600` in [`config.ts`](src/config.ts). On overflow, oldest non-pinned apps evict first along with their edges; orphaned builders fall off; pinned roots are never evicted. Designed so a multi-day kiosk run can't OOM the browser.

## Scripts

```bash
pnpm dev          # vite dev server (host-bound, so other devices on LAN can hit it)
pnpm build        # tsc -b && vite build
pnpm typecheck    # tsc -b
pnpm test         # vitest run
pnpm test:watch   # vitest in watch mode
pnpm preview      # serve the build output
```

## Environment

Copy `.env.example` to `.env.local` and tweak as needed.

| Variable | Effect |
|---|---|
| `VITE_USE_DEMO=1` | Force demo mode at build time (same effect as `?demo=1`) |
| `VITE_USE_MOCK=1` | Force synthetic mock data |
| `VITE_USE_DIRECT=1` | Connect directly to Paseo Asset Hub (`wss://paseo-asset-hub-next-rpc.polkadot.io`) instead of routing through the host |
| `VITE_PLAYGROUND_REGISTRY_PACKAGE` | Override the registry package name (default `@w3s/playground-registry`) |

## Security

> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

This repository contains reference / proof-of-concept code and patterns. It is intended for reference and experimentation, not as a production-ready artefact. Unless a specific release states otherwise, it has **not** received a full security audit.

Before deploying this for real use cases, you are responsible for:

- Reviewing the code yourself — we publish a reference, not a hardened production build.
- Checking that dependencies are up to date and free of known vulnerabilities.
- Securing your own fork or deployment environment (keys, secrets, network configuration).
- Tracking the latest tagged release/commits for security fixes; older releases are not backported.

For Parity's security disclosure process and Bug Bounty programme, see https://parity.io/bug-bounty.

## License

Apache-2.0. See [LICENSE](LICENSE).
