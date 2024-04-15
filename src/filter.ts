import { Event } from "./event";
import { z } from "zod";

export class Filter {
  static readonly stringSchema = z.string().regex(/^[a-f0-9]{64}$/);
  static readonly schema = z.object({
      ids: z.array(Filter.stringSchema).optional(),
      authors: z.array(Filter.stringSchema).optional(),
      kinds: z.array(z.number()).optional(),
      "#e": z.array(Filter.stringSchema).optional(),
      "#p": z.array(Filter.stringSchema).optional(),
      tags: z.object({}).optional(),
      since: z.number().optional(),
      until: z.number().optional(),
      limit: z.number().optional(),
  });

  // A list of event ids
  ids?: string[];
  // A list of lowercase pubkeys, the pubkey of an event must be one of these
	authors?: string[];
  // A list of a kind numbers
	kinds?: number[];
  // A list of tag values, for #e — a list of event ids, for #p — a list of pubkeys, etc
  e?: string[];
  p?: string[];
  // An integer unix timestamp in seconds, events must be newer than this to pass
	since?: number;
  // An integer unix timestamp in seconds, events must be older than this to pass 
	until?: number;
  // Maximum number of events relays SHOULD return in the initial query. This
  //  limit is not checked by isFilteredEvent
	limit?: number;

  constructor(obj: Partial<Filter>) {
    const parsed = Filter.schema.parse(obj);
    Object.assign(this, parsed, {["p"]: parsed["#p"], ["e"]: parsed["#e"]});
  }

  isFilteredEvent(event: Event): boolean {
    // TODO(perf): This function is invoked in a tight loop ordering these
    //  statements based on their frequency of use would improve performance.
    //  Furthermore, pushing down these filters to the storage layer would 
    //  improve performance for newly created subscriptions. 
    if (this.ids && !this.ids.includes(event.id)) {
      return true;
    }

    if (this.authors && !this.authors.includes(event.pubkey)) {
      return true;
    }

    if (this.kinds && !this.kinds.includes(event.kind)) {
      return true;
    }

    if (this.e && !this.e.includes(event.id)) {
      return true;
    }

    if (this.p && !this.p.includes(event.pubkey)) {
      return true;
    }

    if (this.since && this.since > event.created_at) {
      return true;
    }

    if (this.until && this.until < event.created_at) {
      return true;
    }

    return false;
  }
}
