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

const NODE_ITEMS = [
  { cls: "lg-app", label: "App" },
  { cls: "lg-pinned", label: "Tutorial / sample app" },
  { cls: "lg-builder", label: "Builder" },
  { cls: "lg-dev", label: "Dev account" },
];

const EDGE_ITEMS = [
  { cls: "lg-lineage", label: "Mod lineage" },
  { cls: "lg-ownership", label: "Owns" },
];

export function Legend() {
  return (
    <div className="legend">
      {NODE_ITEMS.map((it) => (
        <div className="lg-row" key={it.label}>
          <span className={`lg-dot ${it.cls}`} />
          <span>{it.label}</span>
        </div>
      ))}
      {EDGE_ITEMS.map((it) => (
        <div className="lg-row" key={it.label}>
          <span className={`lg-line ${it.cls}`} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}