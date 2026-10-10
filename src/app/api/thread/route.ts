import { HttpError, json, route, str } from "@/lib/api";
import { getThread } from "@/lib/mail";

export const GET = route(async (req, s) => {
  const p = req.nextUrl.searchParams;
  const folder = str(p.get("folder"), 500);
  const uid = Number(p.get("uid"));
  if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, "errors.badMessage");
  return json({ items: await getThread(s, folder, uid) });
});
