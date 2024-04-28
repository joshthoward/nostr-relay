import { z } from "zod";
import { verifyEvent } from "nostr-tools";

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

  constructor(obj: Partial<Event>) {
    let parsed;
    try {
      parsed = Event.schema.parse(obj);
    } catch (error) {
      throw Error("event could not be parsed");
    }

    if (!verifyEvent(parsed)) {
      throw Error("event could not be verified");
    }

    if (![0, 1, 3].includes(parsed.kind)) {
      throw Error("event kind is unsupported");
    }

    Object.assign(this, parsed);
  }
}
