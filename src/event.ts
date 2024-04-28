import { z } from "zod";
import { verifyEvent } from "nostr-tools";
import { secondsSinceEpoch } from "./util";

export class Event {
  static readonly schema = z.object({
    id: z.string(),
    pubkey: z.string(),
    created_at: z.number(),
    kind: z.number(),
    tags: z.array(z.array(z.string())),
    content: z.string(),
    sig: z.string(),
  });

  id!: string;
	pubkey!: string;
	created_at!: number;
	kind!: number;
	tags!: string[][];
	content!: string;
	sig!: string;

  // This constructor should throw if an invalid event is provided. The current
  //  approach is to be explicit about the kinds of events that are excepted to
  //  avoid a client presuming that functionality is present when it is not. It
  //  may be the case that this behavior is relaxed post-alpha. Accepting an
  //  event that indicates that a client is not upholding the standard of
  //  privacy will be avoided.
  constructor(obj: Partial<Event>) {
    // TODO: Do not accept future dated events
    let parsed;
    try {
      parsed = Event.schema.parse(obj);
    } catch (error) {
      throw Error("event could not be parsed");
    }

    if (parsed.created_at > secondsSinceEpoch()) {
      throw Error("event cannot be future dated");
    }

    if (!verifyEvent(parsed)) {
      throw Error("event could not be verified");
    }

    // This relay will verify that seals do not reveal their recipients, but
    //  not that their payload is correctly formed, i.e. encrypted and unsigned
    if (parsed.kind === 13 && parsed.tags.length !== 0) {
      throw Error("seals must not have tags");
    }

    if (![0, 1, 3, 13, 1059].includes(parsed.kind)) {
      throw Error("event kind is unsupported");
    }

    Object.assign(this, parsed);
  }

  get index() {
    return this.pubkey + "/" + this.id;
  }
}
