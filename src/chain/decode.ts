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

// SCALE decoding for the registry's typed event payloads.
//
// Wire layouts (from playground-app/contracts/registry/lib.rs):
//   PointAwardEvent : Address(20) ++ String(domain)
//   StarPointEvent  : Address(20) ++ String(domain) ++ Address(20)
//   ModPointEvent   : Address(20 recipient) ++ String(source) ++ Address(20 modder) ++ String(modDomain)
// String = compact-u32 length prefix ++ utf8 bytes. Address = 20 raw bytes.

export interface CompactResult {
  value: number;
  size: number;
}

export function decodeCompactU32(bytes: Uint8Array, offset: number): CompactResult {
  const b0 = bytes[offset];
  const mode = b0 & 0b11;
  if (mode === 0) return { value: b0 >>> 2, size: 1 };
  if (mode === 1) {
    const b1 = bytes[offset + 1];
    return { value: (b0 | (b1 << 8)) >>> 2, size: 2 };
  }
  if (mode === 2) {
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];
    const b3 = bytes[offset + 3];
    return {
      value: ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 2) >>> 0,
      size: 4,
    };
  }
  throw new Error("compact mode 3 (big int) not supported for event payloads");
}

export interface StringResult {
  value: string;
  next: number;
}

export function decodeStringAt(bytes: Uint8Array, offset: number): StringResult {
  const { value: len, size } = decodeCompactU32(bytes, offset);
  const start = offset + size;
  const end = start + len;
  return { value: new TextDecoder().decode(bytes.subarray(start, end)), next: end };
}

export interface AddressResult {
  value: `0x${string}`;
  next: number;
}

export function addressHexAt(bytes: Uint8Array, offset: number): AddressResult {
  let hex = "0x";
  for (let i = offset; i < offset + 20; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return { value: hex as `0x${string}`, next: offset + 20 };
}

/** Generic helper: the first string after a leading 20-byte address. */
export function decodeFirstDomainAfterAddress(bytes: Uint8Array): string {
  return decodeStringAt(bytes, 20).value;
}

/**
 * Decodes the recipient address from a v17 identity event payload
 * (`IdentityEvent { recipient: Address(20), root_pubkey: [u8;32] }`). Only the
 * leading 20-byte address is read; the 32-byte root tail is intentionally
 * ignored (there is no String to decode — see IDENTITY_EVENTS). Returns a
 * lowercase `0x…` H160.
 */
export function decodeIdentityRecipient(bytes: Uint8Array): `0x${string}` {
  if (bytes.length < 20) {
    throw new Error(`identity event payload too short: ${bytes.length} bytes`);
  }
  return addressHexAt(bytes, 0).value;
}

export interface PointPayload {
  recipient: `0x${string}`;
  domain: string;
}

/** Decodes PointAwardEvent / StarPointEvent (recipient + domain; trailing bytes ignored). */
export function decodePointAward(bytes: Uint8Array): PointPayload {
  const addr = addressHexAt(bytes, 0);
  const domain = decodeStringAt(bytes, addr.next);
  return { recipient: addr.value, domain: domain.value };
}

export interface StarPayload {
  recipient: `0x${string}`;
  domain: string;
  voter: `0x${string}`;
}

/** Decodes StarPointEvent: recipient(owner) ++ domain ++ voter. */
export function decodeStarPoint(bytes: Uint8Array): StarPayload {
  const recipient = addressHexAt(bytes, 0);
  const domain = decodeStringAt(bytes, recipient.next);
  const voter = addressHexAt(bytes, domain.next);
  return { recipient: recipient.value, domain: domain.value, voter: voter.value };
}

export interface ModPointPayload {
  recipient: `0x${string}`;
  source: string;
  modder: `0x${string}`;
  modDomain: string;
}

/** Decodes ModPointEvent: recipient ++ source ++ modder ++ modDomain. */
export function decodeModPoint(bytes: Uint8Array): ModPointPayload {
  const recipient = addressHexAt(bytes, 0);
  const source = decodeStringAt(bytes, recipient.next);
  const modder = addressHexAt(bytes, source.next);
  const modDomain = decodeStringAt(bytes, modder.next);
  return {
    recipient: recipient.value,
    source: source.value,
    modder: modder.value,
    modDomain: modDomain.value,
  };
}