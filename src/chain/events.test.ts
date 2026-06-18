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
import {
  EVENT_NAMES,
  IDENTITY_EVENTS,
  TYPED_PAYLOAD_EVENTS,
  eventNameForTopic,
  topicForEvent,
} from "./events.ts";

describe("event registry", () => {
  it("lists all 15 contract event names", () => {
    expect(EVENT_NAMES).toContain("Published");
    expect(EVENT_NAMES).toContain("ModPointAwarded");
    expect(EVENT_NAMES).toContain("StarPointRefunded");
    expect(EVENT_NAMES).toContain("IdentityLinked");
    expect(EVENT_NAMES).toContain("IdentityCleared");
    expect(EVENT_NAMES.length).toBe(15);
  });

  it("no longer lists the removed v7 username events", () => {
    expect(EVENT_NAMES).not.toContain("UsernameSet");
    expect(EVENT_NAMES).not.toContain("UsernameCleared");
  });

  it("marks the two identity events", () => {
    expect(IDENTITY_EVENTS.has("IdentityLinked")).toBe(true);
    expect(IDENTITY_EVENTS.has("IdentityCleared")).toBe(true);
    expect(IDENTITY_EVENTS.has("Published")).toBe(false);
    expect(IDENTITY_EVENTS.size).toBe(2);
  });

  it("marks the six SCALE-typed payload events", () => {
    expect(TYPED_PAYLOAD_EVENTS.has("ModPointAwarded")).toBe(true);
    expect(TYPED_PAYLOAD_EVENTS.has("StarPointAwarded")).toBe(true);
    expect(TYPED_PAYLOAD_EVENTS.has("Published")).toBe(false); // legacy raw-bytes
    expect(TYPED_PAYLOAD_EVENTS.size).toBe(6);
  });

  it("computes a 0x topic hash and round-trips it back to the name", () => {
    const topic = topicForEvent("Published");
    expect(topic).toMatch(/^0x[0-9a-f]{64}$/);
    expect(eventNameForTopic(topic)).toBe("Published");
  });

  it("round-trips every event name through its topic", () => {
    for (const name of EVENT_NAMES) {
      expect(eventNameForTopic(topicForEvent(name))).toBe(name);
    }
  });

  it("returns undefined for an unknown topic", () => {
    expect(eventNameForTopic("0x" + "00".repeat(32))).toBeUndefined();
  });
});