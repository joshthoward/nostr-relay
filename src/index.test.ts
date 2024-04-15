import { ClientMessageType, ServerMessageType, ServerErrorPrefixes } from "./types";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { exampleEvent } from "./util";

const baseUrl = "ws://127.0.0.1:8787"

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
  });
});
