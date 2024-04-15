import { Filter } from "./filter";
import { exampleEvent } from "./util";
import { describe, expect, it } from "vitest";

function powerSet<K extends Object = Filter>(obj: K): K[] {
  const keys = Object.keys(obj);
  
  const subsets: (index?: number, curr?: K) => K[] = (index = 0, curr = {} as K) => {
    if (index === keys.length) {
      return [curr];
    }
    const currentKey = keys[index];
    const subsetsWithoutCurrentKey = subsets(index + 1, { ...curr });
    const subsetsWithCurrentKey = subsets(index + 1, { ...curr, [currentKey]: obj[currentKey as keyof K] });
    return [...subsetsWithoutCurrentKey, ...subsetsWithCurrentKey];
  };
  
  return subsets();
}

describe("Filter", () => {
  const exampleFilter = {
    ids: [
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65",
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a66",
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a67",
    ],
    authors: [
      "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
      "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee94",
    ],
    kinds: [1, 2, 3],
    "#e": [
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65",
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a66"
    ],
    "#p": [
      "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
      "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee94"
    ],
    since: 1648867200,
    until: 1648867200,
    limit: 10
  }

  it("Should succeed with valid JSON", () => {
    new Filter(exampleFilter);
    powerSet(exampleFilter).forEach((subset: any) => new Filter(subset))
  });

  it("Should throw with invalid JSON", () => {
    // TODO: Implement me
  });

  it("Should be able to filter events", () => {
    const applyFilter = (f: Partial<Filter>) => new Filter(f).isFilteredEvent(exampleEvent);
    expect(applyFilter({})).toEqual(false);
    expect(applyFilter({ ids: ["4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65"] })).toEqual(false);
    expect(applyFilter({ ids: ["4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a66"] })).toEqual(true);
    expect(applyFilter({ authors: ["6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93"] })).toEqual(false);
    expect(applyFilter({ authors: ["6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee94"] })).toEqual(true);
    expect(applyFilter({ kinds: [1] })).toEqual(false);
    expect(applyFilter({ kinds: [2] })).toEqual(true);
    // TODO: Fix the @ts-ignore lines below
    // @ts-ignore
    expect(applyFilter({ "#e": ["4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65"] })).toEqual(false);
    // @ts-ignore
    expect(applyFilter({ "#e": ["4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a66"] })).toEqual(true);
    // @ts-ignore
    expect(applyFilter({ "#p": ["6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93"] })).toEqual(false);
    // @ts-ignore
    expect(applyFilter({ "#p": ["6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee94"] })).toEqual(true);
    expect(applyFilter({ since: 1673347337 })).toEqual(false);
    expect(applyFilter({ since: 1673347338 })).toEqual(true);
    expect(applyFilter({ until: 1673347337 })).toEqual(false);
    expect(applyFilter({ until: 1673347336 })).toEqual(true);
    expect(applyFilter({ limit: 0 })).toEqual(false);
  });
});
