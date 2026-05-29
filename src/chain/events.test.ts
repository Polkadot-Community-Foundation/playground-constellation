import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  TYPED_PAYLOAD_EVENTS,
  USERNAME_EVENTS,
  eventNameForTopic,
  topicForEvent,
} from "./events.ts";

describe("event registry", () => {
  it("lists all 15 contract event names", () => {
    expect(EVENT_NAMES).toContain("Published");
    expect(EVENT_NAMES).toContain("ModPointAwarded");
    expect(EVENT_NAMES).toContain("StarPointRefunded");
    expect(EVENT_NAMES).toContain("UsernameSet");
    expect(EVENT_NAMES).toContain("UsernameCleared");
    expect(EVENT_NAMES.length).toBe(15);
  });

  it("marks the two username events", () => {
    expect(USERNAME_EVENTS.has("UsernameSet")).toBe(true);
    expect(USERNAME_EVENTS.has("UsernameCleared")).toBe(true);
    expect(USERNAME_EVENTS.has("Published")).toBe(false);
    expect(USERNAME_EVENTS.size).toBe(2);
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
