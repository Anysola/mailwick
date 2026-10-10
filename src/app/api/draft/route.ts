import { HttpError, json, route } from "@/lib/api";
import { discardDraft, saveDraft } from "@/lib/compose";
import { readDraft } from "@/lib/draft-request";

export const POST = route(async (req, s) => {
  const { draft, draftUid } = await readDraft(req);
  return json(await saveDraft(s, draft, draftUid));
});

export const DELETE = route(async (req, s) => {
  const uid = Number(req.nextUrl.searchParams.get("uid"));
  if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, "errors.badDraft");
  await discardDraft(s, uid);
  return json({ ok: true });
});
