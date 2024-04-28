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

export interface Limitations {
  max_message_length?: number;
  max_subscription?: number;
  max_filters?: number;
  max_limit?: number;
  max_subid_length?: number;
  min_prefix?: number;
  max_event_tags?: number;
  max_content_length?: number;
  min_pow_difficulty?: number;
  auth_required?: boolean;
  payment_required?: boolean;
}

export interface RelayInformation {
  name: string;
  description: string;
  pubkey: string;
  contact: string;
  supported_nips: number[];
  software?: string;
  version?: string;
  limitations?: Limitations;
}
