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

import { isInsideContainerSync } from "@parity/product-sdk-host";
import { createChainSource } from "./liveSource.ts";
import { createHighlightsSource } from "./highlights.ts";
import { withExcludedDomains } from "./filter.ts";
import { createMockSource } from "./mock.ts";
import { createDemoSource } from "../demo/demoSource.ts";
import type { ConstellationSource } from "./source.ts";

export type SourceMode = "mock" | "live" | "demo";

export interface SelectedSources {
  /** The primary source — provides loadSnapshot + live LogicalEvents. */
  primary: ConstellationSource;
  mode: SourceMode;
  /** Auxiliary sources — emit highlights, relabels, etc. No snapshot. */
  auxiliary: ConstellationSource[];
}

/** Demo mode = scripted realistic data for the summit recording. Remove the
 *  src/demo/ folder + this check when the real network is restored. */
function demoRequested(): boolean {
  if (import.meta.env.VITE_USE_DEMO === "1") return true;
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).has("demo");
  }
  return false;
}

/**
 * Choose the data sources. The primary handles snapshot + live events;
 * auxiliaries (currently: registry highlights) only run when we're actually
 * pointed at a chain — there's nothing to poll for mock or demo.
 *
 *  - ?demo=1 / VITE_USE_DEMO=1 → scripted summit-demo data (reports as "demo").
 *  - VITE_USE_MOCK=1   → synthetic mock data.
 *  - VITE_USE_DIRECT=1 → real chain via a direct RPC connection (dev: view real
 *    data in a plain browser, outside the host).
 *  - inside Polkadot Desktop → real chain, host-routed (production).
 *  - otherwise (plain dev browser) → mock fallback.
 */
export function selectSources(): SelectedSources {
  if (demoRequested()) {
    return { primary: createDemoSource(), mode: "demo", auxiliary: [] };
  }
  if (import.meta.env.VITE_USE_MOCK === "1") {
    return { primary: createMockSource(), mode: "mock", auxiliary: [] };
  }
  // Live modes: wrap both sources so excluded apps/accounts (e.g. e2e-test
  // fixtures) never reach the graph, feed, ticker, or totals. See chain/filter.ts.
  if (import.meta.env.VITE_USE_DIRECT === "1") {
    return {
      primary: withExcludedDomains(createChainSource("direct")),
      mode: "live",
      auxiliary: [withExcludedDomains(createHighlightsSource("direct"))],
    };
  }
  if (isInsideContainerSync()) {
    return {
      primary: withExcludedDomains(createChainSource("host")),
      mode: "live",
      auxiliary: [withExcludedDomains(createHighlightsSource("host"))],
    };
  }
  return { primary: createMockSource(), mode: "mock", auxiliary: [] };
}