import { ClientMessageType, ServerErrorPrefixes, ServerMessageType } from "./types"; 
import { Event } from "./event";
import { Filter } from "./filter";

export interface Env {
  NOSTR_RELAY: DurableObjectNamespace;
}

function isInvalidSubscriptionId(subscriptionId: string): boolean {
  return subscriptionId.trim().length > 64;
}

export class NostrRelay {
	// Store subscriptions associated with each websocket connection
	subscriptionMap: Map<string, Array<Filter>>;
	state: DurableObjectState;

	constructor(state: DurableObjectState, env: Env) {
		this.subscriptionMap = new Map<string, Array<Filter>>();
		this.state = state;
	}

	private async handleMessage(server: WebSocket, message: MessageEvent) {
		try {
			// TODO: Handle case when ArrayBuffer is sent
			const [messageType, ...remainder] = JSON.parse(message.data as string);

			switch (messageType) {
				case ClientMessageType.EVENT: {
					const [eventRaw] = remainder;

          let event: Event;
          try {
            event = new Event(eventRaw);
          } catch (error: any) {
            server.send(JSON.stringify(["OK", eventRaw.id, false, `invalid: ${error.message}`]));
            return;
          }

          // Events of kind 0 or 3 are metadata or follower lists respectively which overwrite past events
          if (event.kind === 0 || event.kind === 3) {
            // TODO(perf): This involves a full table scan and could be improved
            const previousEvents = await this.state.storage.list<Event>();
            for (const previousEvent of previousEvents.values()) {
              if (previousEvent.pubkey === event.pubkey) {
                await this.state.storage.delete(previousEvent.id);
                break;
              }
            }
          }

          await this.state.storage.put(event.id, event);
					server.send(JSON.stringify(["OK", event.id, true, ""]));

          this.subscriptionMap.forEach((filters, subscriptionId) => {
            const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
            if (!isFilteredEvent) {
              server.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
            }
          });
					break;
				}

				case ClientMessageType.REQ: {
					const [subscriptionId, ...filtersRaw] = remainder;
          if (isInvalidSubscriptionId(subscriptionId)) {
            server.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.INVALID}: subscription ID is invalid`]));
            return
          }

          let filters: Filter[];
          try {
            filters = filtersRaw.map((filter: Filter) => new Filter(filter));
          } catch (error) {
            server.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.INVALID}: filters are invalid`]));
            return;
          }

          if (this.subscriptionMap.has(subscriptionId)) {
            server.send(JSON.stringify(["CLOSED", subscriptionId, `${ServerErrorPrefixes.DUPLICATE}: ${subscriptionId} already opened`]));
            return
          }

					this.subscriptionMap.set(subscriptionId, filters);
          
          // Take the highest limit requested by a filter or default to 1000 if no limit is provided
          const limit = filters.reduce(
            (acc: number | undefined, f: Filter) => f.limit ? Math.max(acc || 0, f.limit) : acc,
            undefined
          ) || 1000;

          const events = await this.state.storage.list<Event>();
					[...events.entries()]
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .slice(0, limit)
            .forEach(([_key, event]) => {
            const isFilteredEvent = filters.reduce((acc: boolean, f: Filter) => acc  || f.isFilteredEvent(event), false);
            if (!isFilteredEvent) {
              server.send(JSON.stringify([ServerMessageType.EVENT, subscriptionId, event]))
            }
          });

					server.send(JSON.stringify([ServerMessageType.EOSE, subscriptionId]));
					break;
				}

				case ClientMessageType.CLOSE: {
					const [subscriptionId] = remainder;
          if (this.subscriptionMap.delete(subscriptionId)) {
            server.send(JSON.stringify([ServerMessageType.CLOSED, subscriptionId, ""]));
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

		server.accept();

		server.addEventListener("message", (messageEvent) => {
			console.log("WebSocket received messageEvent: ", messageEvent);
			this.handleMessage(server, messageEvent);
		});

		server.addEventListener("close", (closeEvent) => {
			console.log("WebSocket has been closed: ", closeEvent);
			server.close()
		});

		server.addEventListener("error",  (errorEvent) => {
			console.error("WebSocket has been closed due to an error: ", errorEvent);
			server.close()
		});

		return new Response(null, { status: 101, webSocket: client });
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== "GET") {
			return new Response("Expected Method: GET", { status: 400 });
		}

		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}

		const id = env.NOSTR_RELAY.newUniqueId();
		const stub = env.NOSTR_RELAY.get(id);
		return stub.fetch(request); 
	}
};
