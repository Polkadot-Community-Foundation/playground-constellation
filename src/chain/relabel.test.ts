import { describe, expect, it, vi } from "vitest";
import { diffUsernames } from "./live.ts";
import type { RelabelEvent } from "./source.ts";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

function collect(): { events: RelabelEvent[]; emit: (r: RelabelEvent) => void } {
  const events: RelabelEvent[] = [];
  return { events, emit: (r) => events.push(r) };
}

describe("diffUsernames", () => {
  it("emits nothing on the baseline poll (prev=null)", () => {
    const { events, emit } = collect();
    diffUsernames(null, new Map([[A, "alice"]]), 1, emit);
    expect(events).toEqual([]);
  });

  it("emits a relabel when an existing username changes", () => {
    const { events, emit } = collect();
    diffUsernames(
      new Map([[A, "alice"]]),
      new Map([[A, "alicia"]]),
      42,
      emit,
    );
    expect(events).toEqual([{ address: A, username: "alicia", ts: 42 }]);
  });

  it("emits null when a username is cleared", () => {
    const { events, emit } = collect();
    diffUsernames(
      new Map([[A, "alice"]]),
      new Map([[A, null]]),
      7,
      emit,
    );
    expect(events).toEqual([{ address: A, username: null, ts: 7 }]);
  });

  it("emits a relabel when a newly-tracked builder gains a name", () => {
    const { events, emit } = collect();
    diffUsernames(
      new Map([[A, "alice"]]),
      new Map([
        [A, "alice"],
        [B, "bob"],
      ]),
      9,
      emit,
    );
    expect(events).toEqual([{ address: B, username: "bob", ts: 9 }]);
  });

  it("emits a null relabel when an address falls out of the top-N with a name", () => {
    const { events, emit } = collect();
    diffUsernames(
      new Map([
        [A, "alice"],
        [B, "bob"],
      ]),
      new Map([[A, "alice"]]),
      11,
      emit,
    );
    expect(events).toEqual([{ address: B, username: null, ts: 11 }]);
  });

  it("does not emit when an address falls out of top-N without a name", () => {
    const { events, emit } = collect();
    diffUsernames(
      new Map([
        [A, "alice"],
        [C, null],
      ]),
      new Map([[A, "alice"]]),
      11,
      emit,
    );
    expect(events).toEqual([]);
  });

  it("no-ops when nothing changes", () => {
    const { events, emit } = collect();
    const same = new Map([[A, "alice"]]);
    diffUsernames(same, new Map(same), 0, emit);
    expect(events).toEqual([]);
  });
});

// Sanity: vi import keeps node test runner happy if we later mock anything.
void vi;
