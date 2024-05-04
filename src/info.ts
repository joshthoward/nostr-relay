import { RelayInformation } from "./types";

export async function getRelayInformation(request: Request): Promise<RelayInformation> {
  // TODO: Validate that the request indicates a particular relay and fetch
  //  information for that relay
  return {
    name: "",
    description: "",
    pubkey: "",
    contact: "mailto:joshthoward@gmail.com",
    supported_nips: [1, 2, 5, 11, 42, 59],
    software: "https://github.com/joshthoward/nostr-relay",
    version: "alpha",
    limitations: {
      auth_required: false,
      payment_required: false,
    }
  }
}
