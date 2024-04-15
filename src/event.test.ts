import { Event } from "./event";
import { exampleEvent } from "./util";
import { describe, expect, it } from "vitest";

describe("Event", () => {
  // TODO: Add more test cases
  it("Should succeed with valid JSON", () => {
    new Event(exampleEvent);
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