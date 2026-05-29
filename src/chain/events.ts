import { bytesToHex, keccak256, utf8ToBytes } from "@parity/product-sdk-utils";

/** All event names the registry emits. Order is not significant. */
export const EVENT_NAMES = [
  "Published",
  "Unpublished",
  "Rated",
  "RatingRemoved",
  "VisibilityChanged",
  "Pinned",
  "Unpinned",
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
  "ModPointAwarded",
  "StarPointAwarded",
  "StarPointRefunded",
  "UsernameSet",
  "UsernameCleared",
] as const;

export type RegistryEvent = (typeof EVENT_NAMES)[number];

/**
 * Events whose `data` is a SCALE-encoded typed payload (recipient + domain,
 * possibly more). The rest carry a single string as raw UTF-8 bytes — domain
 * for the raw-domain events, username for the username events.
 */
export const TYPED_PAYLOAD_EVENTS: ReadonlySet<RegistryEvent> = new Set<RegistryEvent>([
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
  "ModPointAwarded",
  "StarPointAwarded",
  "StarPointRefunded",
]);

/**
 * Username events carry the username string as raw UTF-8 bytes. The chain
 * doesn't include the affected address in the event, so the listener must
 * batch-resolve usernames for known builders to discover who changed.
 */
export const USERNAME_EVENTS: ReadonlySet<RegistryEvent> = new Set<RegistryEvent>([
  "UsernameSet",
  "UsernameCleared",
]);

/** `topic[0]` for an event: keccak256 of the bare event name (matches the contract). */
export function topicForEvent(name: RegistryEvent): `0x${string}` {
  return ("0x" + bytesToHex(keccak256(utf8ToBytes(name)))) as `0x${string}`;
}

const TOPIC_TO_NAME: ReadonlyMap<string, RegistryEvent> = new Map(
  EVENT_NAMES.map((name) => [topicForEvent(name).toLowerCase(), name]),
);

/** Resolve a `topic[0]` hex string back to an event name, or undefined if unknown. */
export function eventNameForTopic(topicHex: string): RegistryEvent | undefined {
  return TOPIC_TO_NAME.get(topicHex.toLowerCase());
}
