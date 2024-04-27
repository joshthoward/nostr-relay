import { z } from "zod";
import { verifyEvent } from "nostr-tools/pure";

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
    const parsed = Event.schema.parse(obj);

    if (!verifyEvent(parsed)) {
      throw Error("Could not verify event");
    }

    if (![0, 1].includes(parsed.kind)) {
      throw Error("This relay does not support this event kind");
    }

    Object.assign(this, parsed);
  }
}
