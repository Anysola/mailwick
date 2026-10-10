import { HttpError, json, route, str } from "@/lib/api";
import { getSettings } from "@/lib/compose";
import { readMessage } from "@/lib/mail";

export const GET = route(async (req, s) => {
  const p = req.nextUrl.searchParams;
  const folder = str(p.get("folder"), 500);
  const uid = Number(p.get("uid"));
  if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, "errors.badMessage");
  const settings = await getSettings(s);
  const images = p.get("images") === "1" || settings.loadImages;
  return json(await readMessage(s, folder, uid, images, p.get("peek") !== "1"));
});
