import "server-only";
import type { NextRequest } from "next/server";
import { HttpError } from "./api";
import { cleanAddrs, MAX_TOTAL_ATTACH, type AttachRef, type Draft } from "./compose";

/** multipart: a "data" (JSON) field plus any number of "file" fields */
export async function readDraft(req: NextRequest): Promise<{ draft: Draft; draftUid?: number }> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_TOTAL_ATTACH * 1.4 + 1_000_000) throw new HttpError(413, "errors.attachmentsTooBig");
  const form = await req.formData();
  const raw = form.get("data");
  if (typeof raw !== "string") throw new HttpError(400, "errors.missingData");
  const d = JSON.parse(raw) as Record<string, unknown>;

  const files: Draft["files"] = [];
  for (const f of form.getAll("file")) {
    if (typeof f === "string") continue;
    files.push({ filename: f.name.slice(0, 250) || "file", contentType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) });
  }
  const refs: AttachRef[] = Array.isArray(d.attachRefs)
    ? (d.attachRefs as AttachRef[]).slice(0, 50).map((r) => ({ folder: String(r.folder), uid: Number(r.uid), index: Number(r.index) }))
    : [];
  const rr = d.replyRef as { folder?: unknown; uid?: unknown } | undefined;

  const draft: Draft = {
    to: cleanAddrs(d.to),
    cc: cleanAddrs(d.cc),
    bcc: cleanAddrs(d.bcc),
    subject: String(d.subject || "").replace(/[\r\n]+/g, " ").slice(0, 500),
    html: String(d.html || "").slice(0, 2_000_000),
    inReplyTo: typeof d.inReplyTo === "string" ? d.inReplyTo.slice(0, 1000) : undefined,
    references: Array.isArray(d.references) ? (d.references as unknown[]).map(String).slice(-30) : undefined,
    replyRef: rr && typeof rr.folder === "string" && Number(rr.uid) > 0 ? { folder: rr.folder, uid: Number(rr.uid) } : undefined,
    attachRefs: refs.filter((r) => r.uid > 0 && r.index >= 0),
    files,
  };
  const du = Number(d.draftUid);
  return { draft, draftUid: Number.isInteger(du) && du > 0 ? du : undefined };
}
