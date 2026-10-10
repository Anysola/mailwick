import { HttpError, json, route } from "@/lib/api";
import { sendDraft } from "@/lib/compose";
import { readDraft } from "@/lib/draft-request";
import { hit } from "@/lib/ratelimit";
import { getT } from "@/i18n/server";

export const POST = route(async (req, s) => {
  if (await hit(`send:${s.email}`, 60, 60 * 60)) throw new HttpError(429, "errors.sendLimit");
  const { draft, draftUid } = await readDraft(req);
  const r = await sendDraft(s, draft, draftUid);
  const { t } = await getT();
  return json({ ...r, warnings: r.warnings.map((w) => t(w)) });
});
