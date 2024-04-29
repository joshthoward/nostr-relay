import { DurableObject } from "cloudflare:workers";
import { ClientMessageType, ServerErrorPrefixes, ServerMessageType, Subscription } from "./types"; 
import { Event } from "./event";
import { Filter } from "./filter";
import { getRelayInformation } from "./info";

export interface Env {
  NOSTR_RELAY: DurableObjectNamespace;
}

function isInvalidSubscriptionId(subscriptionId: string): boolean {
  return subscriptionId.trim().length > 64;
}

export class NostrRelay extends DurableObject {
  sessions: Map<WebSocket, Subscription>;

	constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);    
    this.sessions = new Map();
    this.ctx.getWebSockets().forEach((ws) => {
      const subscriptions = ws.deserializeAttachment() ?? new Map();
      this.sessions.set(ws, subscriptions);
    });
	}

	private async handleMessage(ws: WebSocket, message: ArrayBuffer | string) {
		try {
			// TODO: Handle case when ArrayBuffer is sent
			const [messageType, ...remainder] = JSON.parse(message as string);

			switch (messageType) {
				case ClientMessageType.EVENT: {
					const [eventRaw] = remainder;

          let event: Event;
          try {
            event = new Event(eventRaw);
          } catch (error: any) {
            ws.send(JSON.stringify(["OK", eventRaw.id, false, `invalid: ${error.message}`]));
            return;
          }

          // Events of kind 0 or 3 are metadata or follower lists respectively which overwrite past events
          if (event.kind === 0 || event.kind === 3) {
            await this.ctx.storage.transaction(async txn => {
              const previousEvents = await txn.list<Event>({ prefix: event.pubkey });
              for (const previousEvent of previousEvents.values()) {
                if (previousEvent.kind === event.kind) {
                  await txn.delete(new Event(previousEvent).index);
                  break;
                }
              }
              await txn.put(event.index, event);
              ws.send(JSON.stringify(["OK", event.id, true, ""]));  
            });
          } else if (event.kind === 1059) {
            // TODO: Store events of kind 1059 and publish only to recipients after supporting NIP-42
            ws.send(JSON.stringify(["OK", event.id, false, "error: this relay does not store events of kind 1059"]));
            break;
          } else {
            await this.ctx.storage.put(event.index, event);
            ws.send(JSON.stringify(["OK", event.id, true, ""]));  
          }

          this.sessions.forEach((subscriptions, ws) => {
            subscriptions.forEach((filters, subscriptionId) => {
              const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
              if (!isFilteredEvent) {
                ws.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
              }
            });
          });
					break;
				}

				case ClientMessageType.REQ: {
					const [subscriptionId, ...filtersRaw] = remainder;
          if (isInvalidSubscriptionId(subscriptionId)) {
            ws.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.INVALID}: subscription ID is invalid`]));
            return
          }

          let filters: Filter[];
          try {
            filters = filtersRaw.map((filter: Filter) => new Filter(filter));
          } catch (error) {
            ws.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.INVALID}: filters are invalid`]));
            return;
          }

          const subscriptions = this.sessions.get(ws);
          if (subscriptions?.has(subscriptionId)) {
            ws.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.DUPLICATE}: ${subscriptionId} already opened`]));
            return
          }

					subscriptions?.set(subscriptionId, filters);
          ws.serializeAttachment(subscriptions);

          // Take the highest limit requested by a filter or default to 1000 if no limit is provided
          const limit = filters.reduce(
            (acc: number | undefined, f: Filter) => f.limit ? Math.max(acc || 0, f.limit) : acc,
            undefined
          ) || 1000;

          // TODO(perf): Push down filter on pubkey
          const events = await this.ctx.storage.list<Event>();
					[...events.entries()]
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .slice(0, limit)
            .forEach(([_key, event]) => {
            const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
            if (!isFilteredEvent) {
              ws.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
            }
          });

					ws.send(JSON.stringify([ServerMessageType.EOSE, subscriptionId]));
					break;
				}

				case ClientMessageType.CLOSE: {
					const [subscriptionId] = remainder;
          const subscriptions = this.sessions.get(ws);
          if (subscriptions?.delete(subscriptionId)) {
            ws.serializeAttachment(subscriptions);
            ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, ""]));
          }
					break;
				}
				default:
					throw new Error(`Unknown message type: ${messageType}`);
			}
		} catch (error) {
			console.error(error);
		}
	}

	async fetch(_request: Request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);
    this.sessions.set(server, new Map());

		return new Response(null, { status: 101, webSocket: client });
	}

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    console.log("WebSocket received message: ", message);
    this.handleMessage(ws, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log(`WebSocket connection has been closed: `, JSON.stringify({ code, reason, wasClean }));
    this.sessions.delete(ws);
    ws.close();
  }

  async webSocketError(ws: WebSocket, error: any) {
    const message = (error instanceof Error) ? error.message : error;
    console.error("WebSocket connection has been closed due to an error: ", message);
    this.sessions.delete(ws);
    ws.close();
  }
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== "GET") {
			return new Response("Expected Method: GET", { status: 400 });
		}

    if (request.headers?.get("Accept") === "application/nostr+json") {
      return Response.json(await getRelayInformation(request));
    }

		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}

		const id = env.NOSTR_RELAY.newUniqueId();
		const stub = env.NOSTR_RELAY.get(id);
		return stub.fetch(request); 
	}
};
