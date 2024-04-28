import { ClientMessageType, ServerMessageType, ServerErrorPrefixes } from "./types";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { exampleEvent } from "./util";
import { finalizeEvent, generateSecretKey, verifiedSymbol } from "nostr-tools";

const baseUrl = "ws://127.0.0.1:8787"

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
  return new Promise(function (resolve: any) {
    setTimeout(function () {
      if (ws.readyState === state) {
        resolve();
      } else {
        waitForWebSocketState(ws, state).then(resolve);
      }
    }, 5);
  });
}

async function getWebSocketResponses(requests: any[], numResponses?: number): Promise<any[]>  {
  if (!numResponses) {
    numResponses = requests.length;
  }

  const ws = new WebSocket(baseUrl);
  await waitForWebSocketState(ws, ws.OPEN);

  let responses: any[] = [];
  ws.addEventListener("message", (event) => {
      responses.push(JSON.parse(event.data as string));
      if (responses.length === numResponses) {
        ws.close();
      }
  });

  requests.forEach((request) => ws.send(JSON.stringify(request)));
  await waitForWebSocketState(ws, ws.CLOSED);
  return responses;
}

describe("NostrRelay", () => {
  
  describe("NIP-01", () => {
    it("should be able to publish well formed events", async () => {
      const responses = await getWebSocketResponses([[ClientMessageType.EVENT, exampleEvent]]);
      expect(responses).toEqual([[ServerMessageType.OK ,"4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""]]);
    });

    it("should be able to request subscription with existing events", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], 4);
      expect(responses).toEqual([
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);  
    });

    it("should be able to request a subscription and receive a new event", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], 4);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]); 
    });

    it("should not be able to request an invalid subscription ID", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bcex"],
      ]);
      expect(responses).toEqual([
        [ServerMessageType.CLOSED, "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bcex", "invalid: subscription ID is invalid"]
      ]);
    });

    it("should not be able to request duplicate subscriptions", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ]);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", `${ServerErrorPrefixes.DUPLICATE}: sub1 already opened`],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request multiple subscriptions", async () => {
        const responses = await getWebSocketResponses([
          [ClientMessageType.REQ, "sub1"],
          [ClientMessageType.REQ, "sub2"],
          [ClientMessageType.CLOSE, "sub1"],
          [ClientMessageType.CLOSE, "sub2"],
        ]);
        expect(responses).toEqual([
          [ServerMessageType.EOSE, "sub1"],
          [ServerMessageType.EOSE, "sub2"],
          [ServerMessageType.CLOSED, "sub1", ""],
          [ServerMessageType.CLOSED, "sub2", ""],
        ]);
    });

    it("should be able to request a subscription with existing events that pass filters", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1", { since: exampleEvent.created_at }, { ids: [exampleEvent.id] }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], 4);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription and receive new events that pass filters", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1", { since: exampleEvent.created_at }, { ids: [exampleEvent.id] }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ], 4);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.EVENT, "sub1", exampleEvent],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);  
    });

    it("should be able to request a subscription with existing events that do not pass filters", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1", { since: Math.floor(Date.now() / 1000) }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ]);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription and filter new events", async () => {
      const responses = await getWebSocketResponses([
        [ClientMessageType.REQ, "sub1", { since: Math.floor(Date.now() / 1000) }],
        [ClientMessageType.EVENT, exampleEvent],
        [ClientMessageType.CLOSE, "sub1"],
      ]);
      expect(responses).toEqual([
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.OK, "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65", true, ""],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);  
    });

    it("should be able to request a subscription with the default limit of events enforced", async () => {
      const events = generateEvents(1001);
      const numResponses = 2003;
      const responses = await getWebSocketResponses([
        ...events.map((event) => [ClientMessageType.EVENT, event]),
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], numResponses);
      expect(responses.length).toEqual(numResponses);
      expect(responses).toEqual([
        ...events.map((event) => [ServerMessageType.OK, event.id, true, ""]),
        ...events.reverse().slice(0, 1000).map((event) => [ServerMessageType.EVENT, "sub1", event]),
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });

    it("should be able to request a subscription with a limit on the number of events", async () => {
      const events = generateEvents(11);
      const numResponses = 23;
      const responses = await getWebSocketResponses([
        ...events.map((event) => [ClientMessageType.EVENT, event]),
        [ClientMessageType.REQ, "sub1", { limit: 10 }],
        [ClientMessageType.CLOSE, "sub1"],
      ], numResponses);
      expect(responses.length).toEqual(numResponses);
      expect(responses).toEqual([
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
        "created_at": Math.floor(Date.now() / 1000),
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

      const responses = await getWebSocketResponses([
        [ClientMessageType.EVENT, followListEvent1],
        [ClientMessageType.EVENT, followListEvent2],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], 5);
      expect(responses).toEqual([
        [ServerMessageType.OK, followListEvent1.id, true, ""],
        [ServerMessageType.OK, followListEvent2.id, true, ""],
        [ServerMessageType.EVENT, "sub1", result],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });

  describe("NIP-05", () => {
    it("should be able to publish and overwrite DNS-based internet identifier metadata events",async () => {
      const eventTemplate1 = {
        "created_at": Math.floor(Date.now() / 1000),
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

      const responses = await getWebSocketResponses([
        [ClientMessageType.EVENT, finalizedEvent1],
        [ClientMessageType.EVENT, finalizedEvent2],
        [ClientMessageType.REQ, "sub1"],
        [ClientMessageType.CLOSE, "sub1"],
      ], 5);
      expect(responses).toEqual([
        [ServerMessageType.OK, finalizedEvent1.id, true, ""],
        [ServerMessageType.OK, finalizedEvent2.id, true, ""],
        [ServerMessageType.EVENT, "sub1", result],
        [ServerMessageType.EOSE, "sub1"],
        [ServerMessageType.CLOSED, "sub1", ""],
      ]);
    });
  });
});
