import { describe, expect, it } from "vitest";
import {
  addressHexAt,
  decodeCompactU32,
  decodeFirstDomainAfterAddress,
  decodeModPoint,
  decodePointAward,
  decodeStarPoint,
} from "./decode.ts";

// --- Independent SCALE wire-format oracle (encodes; the module decodes) ---
function compactU32(n: number): number[] {
  if (n < 64) return [n << 2];
  if (n < 1 << 14) {
    const v = (n << 2) | 0b01;
    return [v & 0xff, (v >> 8) & 0xff];
  }
  const v = (n << 2) | 0b10;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}
function encStr(s: string): number[] {
  const b = [...new TextEncoder().encode(s)];
  return [...compactU32(b.length), ...b];
}
function addr(fill: number): number[] {
  return Array(20).fill(fill);
}
const bytes = (...arrs: number[][]) => Uint8Array.from(arrs.flat());

describe("decodeCompactU32", () => {
  it("decodes a single-byte compact (mode 0)", () => {
    expect(decodeCompactU32(Uint8Array.from([9 << 2]), 0)).toEqual({ value: 9, size: 1 });
  });

  it("decodes a two-byte compact (mode 1) for values >= 64", () => {
    const enc = Uint8Array.from(compactU32(300));
    expect(decodeCompactU32(enc, 0)).toEqual({ value: 300, size: 2 });
  });

  it("respects a non-zero offset", () => {
    const enc = Uint8Array.from([0xff, 0xff, 7 << 2]);
    expect(decodeCompactU32(enc, 2)).toEqual({ value: 7, size: 1 });
  });
});

describe("addressHexAt", () => {
  it("reads 20 bytes as a 0x-prefixed lowercase hex address", () => {
    const b = bytes(addr(0xab));
    const out = addressHexAt(b, 0);
    expect(out.value).toBe("0x" + "ab".repeat(20));
    expect(out.next).toBe(20);
  });
});

describe("decodeFirstDomainAfterAddress", () => {
  it("reads the string that follows the leading 20-byte address", () => {
    const b = bytes(addr(0x01), encStr("chess.dot"));
    expect(decodeFirstDomainAfterAddress(b)).toBe("chess.dot");
  });
});

describe("decodePointAward", () => {
  it("decodes { recipient, domain } (Deploy/Publish/Moddable/Star payload)", () => {
    const b = bytes(addr(0x02), encStr("the-ballot.dot"));
    expect(decodePointAward(b)).toEqual({
      recipient: "0x" + "02".repeat(20),
      domain: "the-ballot.dot",
    });
  });
});

describe("decodeStarPoint", () => {
  it("decodes { recipient, domain, voter } in order", () => {
    const b = bytes(addr(0x0c), encStr("kudos.dot"), addr(0x0d));
    expect(decodeStarPoint(b)).toEqual({
      recipient: "0x" + "0c".repeat(20),
      domain: "kudos.dot",
      voter: "0x" + "0d".repeat(20),
    });
  });
});

describe("decodeModPoint", () => {
  it("decodes { recipient, source, modder, modDomain } in order", () => {
    const b = bytes(
      addr(0x0a), // recipient (source owner)
      encStr("ballot.dot"), // source_domain
      addr(0x0b), // modder
      encStr("my-ballot.dot"), // mod_domain (the child)
    );
    expect(decodeModPoint(b)).toEqual({
      recipient: "0x" + "0a".repeat(20),
      source: "ballot.dot",
      modder: "0x" + "0b".repeat(20),
      modDomain: "my-ballot.dot",
    });
  });
});
