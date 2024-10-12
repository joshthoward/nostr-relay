import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { Event } from "./event";
import { exampleEvent, secondsSinceEpoch } from "./util";
import { describe, expect, it } from "vitest";

describe("Event", () => {
  it("should succeed with valid JSON", () => {
    new Event(exampleEvent);

    {
      const eventTemplate = {
        "created_at": secondsSinceEpoch(),
        "kind": 1,
        "tags": [],
        "content": "Hello, world!",
      }
      const finalizedEvent = finalizeEvent(eventTemplate, generateSecretKey());
      new Event(finalizedEvent);
    }

    {
      const eventTemplate = {
        "created_at": secondsSinceEpoch(),
        "kind": 0,
        "tags": [],
        "content": "{\"name\": \"bob\", \"nip05\": \"bob@example.com\"}"
      }
      const finalizedEvent = finalizeEvent(eventTemplate, generateSecretKey());
      new Event(finalizedEvent);
    }
  });

  it("should fail without verification", () => {
    expect(() => new Event({})).toThrow();
    expect(() => {
      let modifiedEvent = exampleEvent;
      modifiedEvent.sig = "foo";
      new Event(modifiedEvent);
    }).toThrow();
  });

  it("should not accept rumors", () => {
    const rumor = {
      "created_at": 1691518405,
      "content": "Are you going to the party tonight?",
      "tags": [],
      "kind": 1,
      "pubkey": "611df01bfcf85c26ae65453b772d8f1dfd25c264621c0277e1fc1518686faef9",
      "id": "9dd003c6d3b73b74a85a9ab099469ce251653a7af76f523671ab828acd2a0ef9",
    }
    expect(() => {new Event(rumor)}).toThrow("event could not be parsed");
  });

  it("should accept seals", () => {
    const seal = {
      "content": "AqBCdwoS7/tPK+QGkPCadJTn8FxGkd24iApo3BR9/M0uw6n4RFAFSPAKKMgkzVMoRyR3ZS/aqATDFvoZJOkE9cPG/TAzmyZvr/WUIS8kLmuI1dCA+itFF6+ULZqbkWS0YcVU0j6UDvMBvVlGTzHz+UHzWYJLUq2LnlynJtFap5k8560+tBGtxi9Gx2NIycKgbOUv0gEqhfVzAwvg1IhTltfSwOeZXvDvd40rozONRxwq8hjKy+4DbfrO0iRtlT7G/eVEO9aJJnqagomFSkqCscttf/o6VeT2+A9JhcSxLmjcKFG3FEK3Try/WkarJa1jM3lMRQqVOZrzHAaLFW/5sXano6DqqC5ERD6CcVVsrny0tYN4iHHB8BHJ9zvjff0NjLGG/v5Wsy31+BwZA8cUlfAZ0f5EYRo9/vKSd8TV0wRb9DQ=",
      "kind": 13,
      "created_at": 1703015180,
      "pubkey": "611df01bfcf85c26ae65453b772d8f1dfd25c264621c0277e1fc1518686faef9",
      "tags": [],
      "id": "28a87d7c074d94a58e9e89bb3e9e4e813e2189f285d797b1c56069d36f59eaa7",
      "sig": "02fc3facf6621196c32912b1ef53bac8f8bfe9db51c0e7102c073103586b0d29c3f39bdaa1e62856c20e90b6c7cc5dc34ca8bb6a528872cf6e65e6284519ad73",
    }
    new Event(seal);
  });

  it("should accept gift wraps", () => {
    const giftWrap = {
      "content": "AhC3Qj/QsKJFWuf6xroiYip+2yK95qPwJjVvFujhzSguJWb/6TlPpBW0CGFwfufCs2Zyb0JeuLmZhNlnqecAAalC4ZCugB+I9ViA5pxLyFfQjs1lcE6KdX3euCHBLAnE9GL/+IzdV9vZnfJH6atVjvBkNPNzxU+OLCHO/DAPmzmMVx0SR63frRTCz6Cuth40D+VzluKu1/Fg2Q1LSst65DE7o2efTtZ4Z9j15rQAOZfE9jwMCQZt27rBBK3yVwqVEriFpg2mHXc1DDwHhDADO8eiyOTWF1ghDds/DxhMcjkIi/o+FS3gG1dG7gJHu3KkGK5UXpmgyFKt+421m5o++RMD/BylS3iazS1S93IzTLeGfMCk+7IKxuSCO06k1+DaasJJe8RE4/rmismUvwrHu/HDutZWkvOAhd4z4khZo7bJLtiCzZCZ74lZcjOB4CYtuAX2ZGpc4I1iOKkvwTuQy9BWYpkzGg3ZoSWRD6ty7U+KN+fTTmIS4CelhBTT15QVqD02JxfLF7nA6sg3UlYgtiGw61oH68lSbx16P3vwSeQQpEB5JbhofW7t9TLZIbIW/ODnI4hpwj8didtk7IMBI3Ra3uUP7ya6vptkd9TwQkd/7cOFaSJmU+BIsLpOXbirJACMn+URoDXhuEtiO6xirNtrPN8jYqpwvMUm5lMMVzGT3kMMVNBqgbj8Ln8VmqouK0DR+gRyNb8fHT0BFPwsHxDskFk5yhe5c/2VUUoKCGe0kfCcX/EsHbJLUUtlHXmTqaOJpmQnW1tZ/siPwKRl6oEsIJWTUYxPQmrM2fUpYZCuAo/29lTLHiHMlTbarFOd6J/ybIbICy2gRRH/LFSryty3Cnf6aae+A9uizFBUdCwTwffc3vCBae802+R92OL78bbqHKPbSZOXNC+6ybqziezwG+OPWHx1Qk39RYaF0aFsM4uZWrFic97WwVrH5i+/Nsf/OtwWiuH0gV/SqvN1hnkxCTF/+XNn/laWKmS3e7wFzBsG8+qwqwmO9aVbDVMhOmeUXRMkxcj4QreQkHxLkCx97euZpC7xhvYnCHarHTDeD6nVK+xzbPNtzeGzNpYoiMqxZ9bBJwMaHnEoI944Vxoodf51cMIIwpTmmRvAzI1QgrfnOLOUS7uUjQ/IZ1Qa3lY08Nqm9MAGxZ2Ou6R0/Z5z30ha/Q71q6meAs3uHQcpSuRaQeV29IASmye2A2Nif+lmbhV7w8hjFYoaLCRsdchiVyNjOEM4VmxUhX4VEvw6KoCAZ/XvO2eBF/SyNU3Of4SO",
      "kind": 1059,
      "created_at": 1703021488,
      "pubkey": "18b1a75918f1f2c90c23da616bce317d36e348bcf5f7ba55e75949319210c87c",
      "id": "5c005f3ccf01950aa8d131203248544fb1e41a0d698e846bd419cec3890903ac",
      "sig": "35fabdae4634eb630880a1896a886e40fd6ea8a60958e30b89b33a93e6235df750097b04f9e13053764251b8bc5dd7e8e0794a3426a90b6bcc7e5ff660f54259",
      "tags": [["p", "166bf3765ebd1fc55decfe395beff2ea3b2a4e0a8946e7eb578512b555737c99"]],
    }
    new Event(giftWrap);
  })
});