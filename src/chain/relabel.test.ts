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

import { describe, expect, it } from "vitest";
import { emitRelabels, identityRecipientsInBlock } from "./live.ts";
import { topicForEvent } from "./events.ts";
import type { RelabelEvent } from "./source.ts";

const TARGET = "0x" + "f".repeat(40);
const RECIPIENT = "0x" + "a".repeat(40);

/** Build a ContractEmitted-shaped event. `data` defaults to recipient(20)+root(32). */
function ev(eventName: string, contract = TARGET, recipientByte = 0xaa) {
  const data = Uint8Array.from([...Array(20).fill(recipientByte), ...Array(32).fill(0xcd)]);
  return { payload: { contract, topics: [topicForEvent(eventName as never)], data } };
}

describe("identityRecipientsInBlock", () => {
  it("collects the recipient of an IdentityLinked event", () => {
    const out = identityRecipientsInBlock([ev("IdentityLinked")], TARGET);
    expect([...out]).toEqual([RECIPIENT]);
  });

  it("collects the recipient of an IdentityCleared event", () => {
    const out = identityRecipientsInBlock([ev("IdentityCleared")], TARGET);
    expect([...out]).toEqual([RECIPIENT]);
  });

  it("ignores events emitted by a different contract", () => {
    const out = identityRecipientsInBlock([ev("IdentityLinked", "0x" + "1".repeat(40))], TARGET);
    expect(out.size).toBe(0);
  });

  it("ignores non-identity events", () => {
    const out = identityRecipientsInBlock([ev("Published"), ev("StarPointAwarded")], TARGET);
    expect(out.size).toBe(0);
  });

  it("dedupes repeated recipients within a block", () => {
    const out = identityRecipientsInBlock([ev("IdentityLinked"), ev("IdentityCleared")], TARGET);
    expect([...out]).toEqual([RECIPIENT]);
  });
});

describe("emitRelabels", () => {
  it("emits one relabel per resolved address, names and clears alike", () => {
    const events: RelabelEvent[] = [];
    emitRelabels({ [RECIPIENT]: "alice", "0xbeef": null }, 42, (r) => events.push(r));
    expect(events).toEqual([
      { address: RECIPIENT, username: "alice", ts: 42 },
      { address: "0xbeef", username: null, ts: 42 },
    ]);
  });
});
