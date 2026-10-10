// Types shared by client and server.

export type Addr = { name?: string; address: string };

export type Folder = {
  path: string;
  name: string;
  special?: "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | "flagged" | "all";
  delimiter: string;
  depth: number;
  unseen: number;
  total: number;
};

export type MessageSummary = {
  uid: number;
  threadId?: string;
  messageId?: string;
  subject: string;
  from: Addr[];
  to: Addr[];
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  attachments: boolean;
  snippet: string;
  size: number;
  /** in all-folder search: the folder containing the message */
  folder?: string;
};

export type MessageList = {
  folder: string;
  total: number;
  page: number;
  pageSize: number;
  messages: MessageSummary[];
  /** "all": all-folder search result (rows have folder set) */
  scope?: "folder" | "all";
  /** in all-folder search: whether the result limit was exceeded */
  truncated?: boolean;
};

export type Attachment = {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
};

export type MessageFull = {
  folder: string;
  uid: number;
  threadId?: string;
  messageId?: string;
  references: string[];
  subject: string;
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  html: string; // sanitized, to be placed in the iframe
  text: string; // plain text (for reply quoting)
  blockedImages: number;
  attachments: Attachment[];
  size: number;
  /** List-Unsubscribe header */
  unsubscribe?: { url?: string; mailto?: string; oneClick?: boolean };
};

export type ThreadItem = MessageSummary & { folder: string };

export type Settings = { name: string; signature: string; loadImages: boolean; undoSeconds: number };

export const UNDO_CHOICES = [0, 5, 10, 20, 30];
