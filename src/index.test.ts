import {
  ClientMessageType,
  ServerMessageType,
  ServerErrorPrefixes,
  RelayInformation
} from "./types";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import {
  exampleEvent,
  getBaseUrl,
  secondsSinceEpoch,
  stagingChallenge
} from "./util";
import { bytesToHex } from "@noble/hashes/utils";
import {
  type EventTemplate,
  type UnsignedEvent,
  finalizeEvent,
  generateSecretKey,
  nip42,
  nip44,
  nip19,
  getPublicKey,
  getEventHash,
  verifiedSymbol,
} from "nostr-tools";

const environment = process.env.ENVIRONMENT;
const baseUrl = getBaseUrl(environment);
// The local development environment thinks it is speaking to staging for auth checks
const authUrl = getBaseUrl((environment === "dev") ? "staging" : environment);

function generateEvents(length: number) {
  const sk = generateSecretKey();
  return Array.from({ length }, (_, i) => {
    const eventTemplate = {
      "created_at": i,
      "kind": 1,
      "tags": [],
      "content": `Sample content from message: ${i}`,
    }
    const finalizedEvent = finalizeEvent(eventTemplate, sk);
    const {[verifiedSymbol]: _verifiedSymbol, ...result} = finalizedEvent;
    return result;
  });
}

function waitForWebSocketState(ws: WebSocket, state: any) {
  return new Promise((resolve: any) => {
    setTimeout(() => {
      if (ws.readyState === state) {
        resolve();
      } else {
        waitForWebSocketState(ws, state).then(resolve);
      }
    }, 5);
  });
}

async function compareWebSocketResponses(requests: any[], expectedResponses: any[], namedRelay?: string) {
  // Use WebSocket over TLS in staging
  const url = new URL(((process.env.ENVIRONMENT === "staging") ? "wss://" : "ws://") + baseUrl);
  if (namedRelay !== undefined) {
    url.searchParams.set("relay", namedRelay);
  }

  const ws = new WebSocket(url);
  const actualResponses: any[] = [];
  ws.addEventListener("message", (event) => {
    actualResponses.push(JSON.parse(event.data as string));
    if (actualResponses.length === expectedResponses.length) {
      ws.close();
    }
  });
  await waitForWebSocketState(ws, ws.OPEN);
  requests.forEach((request) => ws.send(JSON.stringify(request)));
  await waitForWebSocketState(ws, ws.CLOSED);
  expect(actualResponses).toEqual(expectedResponses);
}

describe("NostrRelay", () => {
  const authEvent = finalizeEvent(nip42.makeAuthEvent(authUrl, stagingChallenge), generateSecretKey());
  console.log({authEvent, 'tags': authEvent.tags});

  describe("NIP-01", () => {
    it("should be able to publish well formed events", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.EVENT, exampleEvent]
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.OK, exampleEvent.id, true, ""],
      ]);
    });

    it("should be able to request subscription with existing events", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);  
    });

    it("should be able to request a subscription and receive a new event", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription from an existing relay", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1", { since: secondsSinceEpoch() }], // Filter out messages from previous test runs
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.CLOSED, "sub1", ""],
      ], "foo");
    });

    it("should not be able to request an invalid subscription ID", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bcex"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.CLOSED, "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bcex", "invalid: subscription ID is invalid"],
      ]);
    });

    it("should not be able to request duplicate subscriptions", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", `${ServerErrorPrefixes.DUPLICATE}: sub1 already opened`],
        [ServerMessageType.CLOSED, "sub1", ""],

      ]);
    });

    it("should be able to request multiple subscriptions", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.REQ, "sub2"],
        [ClientMessageType.CLOSE, "sub1"],
        [ClientMessageType.CLOSE, "sub2"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.EOSE, "sub2"],
        [ServerMessageType.CLOSED, "sub1", ""],
        [ServerMessageType.CLOSED, "sub2", ""],
      ]);
    });

    it("should be able to request a subscription with existing events that pass filters", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1", { since: exampleEvent.created_at }, { ids: [exampleEvent.id] }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription and receive new events that pass filters", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1", { since: exampleEvent.created_at }, { ids: [exampleEvent.id] }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription with existing events that do not pass filters", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1", { since: secondsSinceEpoch() }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription and filter new events", async () => {
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.REQ, "sub1", { since: secondsSinceEpoch() }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription with the default limit of events enforced", async () => {
      const events = generateEvents(1001);
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        ...events.map((event) => [ClientMessageType.EVENT, event]),
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        ...events.map((event) => [ServerMessageType.OK, event.id, true, ""]),
        ...events.reverse().slice(0, 1000).map((event) => [ServerMessageType.EVENT, "sub1", event]),
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription with a limit on the number of events", async () => {
      const events = generateEvents(11);
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        ...events.map((event) => [ClientMessageType.EVENT, event]),
        [ClientMessageType.REQ, "sub1", { limit: 10 }],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        ...events.map((event) => [ServerMessageType.OK, event.id, true, ""]),
        ...events.reverse().slice(0, 10).map((event) => [ServerMessageType.EVENT, "sub1", event]),
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });

  describe("NIP-02", () => {
    it("should be able to publish and overwrite following list events", async () => {
      const followListEventTemplate1 = {
        "created_at": secondsSinceEpoch(),
        "kind": 3,
        "tags": [
          ["p", "91cf9128ab25d80e7f3ba0ad9e747fabf5a62b7a42d1517bea237caa59a4e5ca", "wss://alicerelay.com/", "alice"],
        ],
        "content": "",
      }

      const followListEventTemplate2 = structuredClone(followListEventTemplate1);
      followListEventTemplate2.tags.push(
        ["p", "14aeb128ab25d80e7f3ba0ad9e747fabf5a62b7a42d1517bea237caa59a8dad4", "wss://bobrelay.com/nostr", "bob"]
      );

      const sk = generateSecretKey();
      const followListEvent1 = finalizeEvent(followListEventTemplate1, sk);
      const followListEvent2 = finalizeEvent(followListEventTemplate2, sk);
      const {[verifiedSymbol]: _verifiedSymbol, ...result} = followListEvent2;

      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.EVENT, followListEvent1],
        [ClientMessageType.EVENT, followListEvent2],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.OK, followListEvent1.id, true, ""],
        [ServerMessageType.OK, followListEvent2.id, true, ""],
        [ServerMessageType.EVENT, "sub1", result],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });

  describe("NIP-05", () => {
    it("should be able to publish and overwrite DNS-based internet identifier metadata events", async () => {
      const eventTemplate1 = {
        "created_at": secondsSinceEpoch(),
        "kind": 0,
        "tags": [],
        "content": "{\"name\": \"bob\", \"nip05\": \"bob@example.com\"}",  
      }

      const eventTemplate2 = structuredClone(eventTemplate1);
      eventTemplate2.content = "{\"name\": \"alice\", \"nip05\": \"alice@example.com\"}";

      const sk = generateSecretKey();
      const finalizedEvent1 = finalizeEvent(eventTemplate1, sk);
      const finalizedEvent2 = finalizeEvent(eventTemplate2, sk);
      const {[verifiedSymbol]: _verifiedSymbol, ...result} = finalizedEvent2;

      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.EVENT, finalizedEvent1],
        [ClientMessageType.EVENT, finalizedEvent2],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.OK, finalizedEvent1.id, true, ""],
        [ServerMessageType.OK, finalizedEvent2.id, true, ""],
        [ServerMessageType.EVENT, "sub1", result],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });

  describe("NIP-11", () => {
    it("should be able to fetch relay information", async () => {
      const response = await fetch("http://" + baseUrl, {
        headers: { Accept: 'application/nostr+json' },
      })
      const info = await response.json() as RelayInformation;
      expect(info.name).toEqual("");
      expect(info.description).toContain("");
      expect(info.pubkey).toEqual("");
      expect(info.contact).toEqual("mailto:joshthoward@gmail.com");
      expect(info.supported_nips).toEqual([1, 2, 5, 11, 42, 59]);
      expect(info.software).toEqual("https://github.com/joshthoward/nostr-relay");
      expect(info.version).toEqual("alpha");
      expect(info.limitations?.auth_required).toEqual(false);
      expect(info.limitations?.payment_required).toEqual(false);
    });
  });

  describe("NIP-42", () => {
    async function expectInvalidAuth(badAuthEventTemplate: EventTemplate) {
      const badAuthEvent = finalizeEvent(badAuthEventTemplate, generateSecretKey());
      await compareWebSocketResponses([
        [ClientMessageType.AUTH, badAuthEvent],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, badAuthEvent.id, false, "invalid: authentication event is invalid"],
      ]);
    }

    it("should reject authentication event with wrong relay", async () => {
      await expectInvalidAuth({
        kind: 22242,
        created_at: secondsSinceEpoch(),
        tags: [
          ["relay", "google.com"],
          ["challenge", stagingChallenge],
        ],
        content: '',
      });
    });

    it("should reject authentication event with wrong challenge", async () => {
      await expectInvalidAuth({
        kind: 22242,
        created_at: secondsSinceEpoch(),
        tags: [
          ["relay", authUrl],
          ["challenge", "foo"],
        ],
        content: '',
      });
    });

    it("should reject authentication event with missing tags", async () => {
      await expectInvalidAuth({
        kind: 22242,
        created_at: secondsSinceEpoch(),
        tags: [],
        content: '',
      });
    });

    it("should reject old authentication event", async () => {
      await expectInvalidAuth({
        kind: 22242,
        created_at: secondsSinceEpoch() - 60 * 11,
        tags: [
          ["relay", authUrl],
          ["challenge", stagingChallenge],
        ],
        content: '',
      });
    });
  });

  describe("NIP-59", () => {
    // TODO: Implement a test to ensure that gift wraps are sent to the desired recipient
    it("should store seals and gift wraps", async () => {
      const TWO_DAYS = 2 * 24 * 60 * 60
      const randomNow = () => Math.round(secondsSinceEpoch() - (Math.random() * TWO_DAYS));

      const nip44ConversationKey = (privateKey: Uint8Array, publicKey: string) =>
        nip44.v2.utils.getConversationKey(bytesToHex(privateKey), publicKey);

      const nip44Encrypt = (data: EventTemplate, privateKey: Uint8Array, publicKey: string) =>
        nip44.v2.encrypt(JSON.stringify(data), nip44ConversationKey(privateKey, publicKey));

      const senderPrivateKey =
        nip19.decode("nsec1p0ht6p3wepe47sjrgesyn4m50m6avk2waqudu9rl324cg2c4ufesyp6rdg").data;
      const recipientPublicKey = getPublicKey(
        nip19.decode("nsec1uyyrnx7cgfp40fcskcr2urqnzekc20fj0er6de0q8qvhx34ahazsvs9p36").data);
      const randomKey = generateSecretKey();

      let rumor: UnsignedEvent & {id?: string}= {
        created_at: secondsSinceEpoch(),
        kind: 1,
        content: "Are you going to the party tonight?",
        tags: [],
        pubkey: getPublicKey(senderPrivateKey),
      };
      rumor.id = getEventHash(rumor);

      const seal = finalizeEvent(
        {
          kind: 13,
          content: nip44Encrypt(rumor, senderPrivateKey, recipientPublicKey),
          created_at: randomNow(),
          tags: [],
        },
        senderPrivateKey
      );
      const {[verifiedSymbol]: _verifiedSymbol, ...result} = seal;

      const giftWrap = finalizeEvent(
        {
          kind: 1059,
          content: nip44Encrypt(seal, randomKey, recipientPublicKey),
          created_at: randomNow(),
          tags: [["p", recipientPublicKey]],
        },
        randomKey
      );

      await compareWebSocketResponses([
        [ClientMessageType.AUTH, authEvent],
        [ClientMessageType.EVENT, seal],
        [ClientMessageType.EVENT, giftWrap],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], [
        [ServerMessageType.AUTH, stagingChallenge],
        [ServerMessageType.OK, authEvent.id, true, ""],
        [ServerMessageType.OK, seal.id, true, ""],
        [ServerMessageType.OK, giftWrap.id, true, ""],
        [ServerMessageType.EVENT, "sub1", result],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });
});
