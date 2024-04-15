export enum ClientMessageType {
  EVENT = 'EVENT',
  REQ = 'REQ',
  CLOSE = 'CLOSE',
}
  
export enum ServerMessageType {
  EVENT = "EVENT",
  OK = "OK",
  EOSE = "EOSE",
  CLOSED = "CLOSED",
  NOTICE = "NOTICE",
}

export enum ServerErrorPrefixes {
  DUPLICATE = "duplicate",
  POW = "pow",
  BLOCKED = "blocked",
  RATE_LIMITED = "rate-limited",
  INVALID = "invalid",
  ERROR = "error",
}
