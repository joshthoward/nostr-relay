import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { Event } from "./event";
import { exampleEvent } from "./util";
import { describe, expect, it } from "vitest";

describe("Event", () => {
  it("Should succeed with valid JSON", () => {
    new Event(exampleEvent);

    {
      const eventTemplate = {
        "created_at": Math.floor(Date.now() / 1000),
        "kind": 1,
        "tags": [],
        "content": "Hello, world!",
      }
      const finalizedEvent = finalizeEvent(eventTemplate, generateSecretKey());
      new Event(finalizedEvent);
    }

    {
      const eventTemplate = {
        "created_at": Math.floor(Date.now() / 1000),
        "kind": 0,
        "tags": [],
        "content": "{\"name\": \"bob\", \"nip05\": \"bob@example.com\"}"
      }
      const finalizedEvent = finalizeEvent(eventTemplate, generateSecretKey());
      new Event(finalizedEvent);
    }
  });

  it("Should fail with invalid JSON", () => {
    expect(() => new Event({})).toThrow();
    expect(() => {
      let modifiedEvent = exampleEvent;
      modifiedEvent.sig = "foo";
      new Event(modifiedEvent);
    }).toThrow();
  });
});