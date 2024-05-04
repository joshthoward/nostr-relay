// This example event is used across various test files
export const exampleEvent = {
  "id": "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65",
  "pubkey": "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
  "created_at": 1673347337,
  "kind": 1,
  "content": "Walled gardens became prisons, and nostr is the first step towards tearing down the prison walls.",
  "tags": [
    ["e", "3da979448d9ba263864c4d6f14984c423a3838364ec255f03c7904b1ae77f206"],
    ["p", "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bce"]
  ],
  "sig": "908a15e46fb4d8675bab026fc230a0e3542bfade63da02d542fb78b2a8513fcd0092619a2c8c1221e581946e0191f2af505dfdf8657a414dbca329186f009262"
};

export const baseUrl = "127.0.0.1:8787";

export function getChallenge() {
let buffer = new Uint8Array(64);
  return Array.from(crypto.getRandomValues(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function secondsSinceEpoch() {
  return Math.floor(Date.now() / 1000);
}
