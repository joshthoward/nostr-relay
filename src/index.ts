import { DurableObject } from "cloudflare:workers";
import {
  ClientMessageType,
  ServerErrorPrefixes,
  ServerMessageType,
  Session,
  SubscriptionId,
} from "./types"; 
import { Event } from "./event";
import { Filter } from "./filter";
import { getRelayInformation } from "./info";
import { getBaseUrl, getChallenge, stagingChallenge } from "./util";

export interface Env {
  NOSTR_RELAY: DurableObjectNamespace;
  ENVIRONMENT: string;
}

function isInvalidSubscriptionId(subscriptionId: string): boolean {
  return subscriptionId.trim().length > 64;
}

function isIntendedForRecipient(event: Event, pubkey?: string) {
  if (event.kind !== 1059) {
    return true;
  }

  event.tags.forEach(tag => {
    if (tag[0] === "p" && tag[1] === pubkey) {
      return true;
    }
  });

  return false;
}

export class NostrRelay extends DurableObject<Env> {
  sessions: Map<WebSocket, Session>;

	constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.ctx.getWebSockets().forEach((ws) => {
      const { ...session } = ws.deserializeAttachment();
      this.sessions.set(ws, { ...session });
    });
	}

	private async handleMessage(ws: WebSocket, message: ArrayBuffer | string) {
		try {
			// TODO: Handle case when ArrayBuffer is sent
			const [messageType, ...remainder] = JSON.parse(message as string);

			switch (messageType) {
        case ClientMessageType.AUTH:
				case ClientMessageType.EVENT: {
					const [eventRaw] = remainder;
          await this.publishEvent(ws, eventRaw);
					break;
				}

				case ClientMessageType.REQ: {
					const [subscriptionId, ...filtersRaw] = remainder;
          await this.requestSubscription(ws, subscriptionId, filtersRaw)
					break;
				}

				case ClientMessageType.CLOSE: {
					const [subscriptionId] = remainder;
          this.closeSubscription(ws, subscriptionId);
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

    const challenge = this.env.ENVIRONMENT === "staging" ? stagingChallenge : getChallenge();
    this.sessions.set(server, { challenge, subscriptions: new Map() });
    server.send(JSON.stringify([ServerMessageType.AUTH, challenge]));

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

  private async publishEvent(ws: WebSocket, eventRaw: Event) {
    let event: Event;
    try {
      event = new Event(eventRaw);
    } catch (error: any) {
      ws.send(JSON.stringify([ServerMessageType.OK, eventRaw.id, false, `${ServerErrorPrefixes.INVALID}: ${error.message}`]));
      return;
    }

    const successResponse = JSON.stringify([ServerMessageType.OK, event.id, true, ""]);
    const session = this.sessions.get(ws)!;

    // Events of kind 22242 are authentication events
    if (event.kind === 22242) {
      let isRelayValid = false;
      let isChallengeValid = false;
      event.tags.forEach(tag => {
        if (tag[0] === "relay" &&
            tag[1] === getBaseUrl(this.env.ENVIRONMENT)) {
          isRelayValid = true;
        }
        if (tag[0] === "challenge" && tag[1] === session.challenge) {
          isChallengeValid = true;
        }
      });

      if (isChallengeValid && isRelayValid && event.isRecent) {
        this.sessions.set(ws, { ...session, pubkey: event.pubkey });
        ws.send(successResponse);  
      } else {
        ws.send(JSON.stringify([ServerMessageType.OK, event.id, false, `${ServerErrorPrefixes.INVALID}: authentication event is invalid`]));
      }
      return;
    }

    // Authn is handled within the event constructor by verifying that the event is signed by the
    // private key paired with the provided public key. Authz is handled by this check to ensure
    // that the event public key matches the public key that has been associated with this
    // WebSocket session
    if (!session.pubkey || session.pubkey != event.pubkey) {
      ws.send(JSON.stringify([ServerMessageType.OK, event.id, false, `${ServerErrorPrefixes.AUTH_REQUIRED}: cannot publish events`]));
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
        ws.send(successResponse);  
      });
    } else {
      await this.ctx.storage.put(event.index, event);
      ws.send(successResponse);  
    }

    this.sessions.forEach(({ pubkey, subscriptions }, ws) => {
      if (!isIntendedForRecipient(event, pubkey)) {
        return;
      }

      subscriptions.forEach((filters, subscriptionId) => {
        const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
        if (!isFilteredEvent) {
          ws.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
        }
      });
    });
  }

  private async requestSubscription(ws: WebSocket, subscriptionId: SubscriptionId, filtersRaw: Filter[]) {
    if (isInvalidSubscriptionId(subscriptionId)) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.INVALID}: subscription ID is invalid`]));
      return
    }

    let filters: Filter[];
    try {
      filters = filtersRaw.map((filter: Filter) => new Filter(filter));
    } catch (error) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.INVALID}: filters are invalid`]));
      return;
    }

    const session = this.sessions.get(ws);
    if (!session) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.INVALID}: session is invalid`]));
      return;
    }
    const { subscriptions, pubkey, ...remainder } = session;

    if (!pubkey) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.AUTH_REQUIRED}: cannot request subscription`]));
      return;
    }

    // TODO: Check if session is permitted to request subscriptions

    if (subscriptions?.has(subscriptionId)) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.DUPLICATE}: ${subscriptionId} already opened`]));
      return;
    }

    subscriptions?.set(subscriptionId, filters);
    ws.serializeAttachment({subscriptions, pubkey, ...remainder});

    // Take the highest limit requested by a filter or default to 1000 if no limit is provided
    const limit = filters.reduce(
      (acc: number | undefined, f: Filter) => f.limit ? Math.max(acc || 0, f.limit) : acc,
      undefined
    ) || 1000;

    // TODO(perf): Push down filter on pubkey
    const events = await this.ctx.storage.list<Event>();
    [...events.entries()]
      // Only send gift wrap events to the intended recipient
      .filter(([_key, event]) => isIntendedForRecipient(event, pubkey))
      .sort((a, b) => b[1].created_at - a[1].created_at)
      .slice(0, limit)
      .forEach(([_key, event]) => {
      const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
      if (!isFilteredEvent) {
        ws.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
      }
    });

    ws.send(JSON.stringify([ServerMessageType.EOSE, subscriptionId]));
  }

  private closeSubscription(ws: WebSocket, subscriptionId: SubscriptionId) {
    const session = this.sessions.get(ws)!;
    if (!session) {
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, `${ServerErrorPrefixes.INVALID}: session is invalid`]));
      return;
    }
    const { subscriptions, ...remainder } = session;

    if (subscriptions?.delete(subscriptionId)) {
      ws.serializeAttachment({subscriptions, ...remainder});
      ws.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, ""]));
    }
  }
}

export default {
	async fetch(request, env, _ctx) {
    if (env.ENVIRONMENT === "staging") {
      console.log({request});
    }

		if (request.method !== "GET") {
			return new Response("Expected Method: GET", { status: 400 });
		}

    if (request.headers?.get("Accept") === "application/nostr+json") {
      return Response.json(await getRelayInformation(request));
    }

		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}

    const url = new URL(request.url);
    const namedRelay = url.searchParams.get("relay");

    try {
      const id = (namedRelay) ? env.NOSTR_RELAY.idFromName(namedRelay) : env.NOSTR_RELAY.newUniqueId();
      const stub = env.NOSTR_RELAY.get(id);
      return stub.fetch(request); 
    } catch (error) {
      console.log({message: "Top level try catch caught an error.", error});
      return new Response("Internal Server Error", { status: 500 });
    }
	}
} satisfies ExportedHandler<Env>;
