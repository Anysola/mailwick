import { HttpError, route, str } from "@/lib/api";
import { getRawSource } from "@/lib/mail";

// Downloads the raw source as .eml.
export const GET = route(async (req, s) => {
  const p = req.nextUrl.searchParams;
  const folder = str(p.get("folder"), 500);
  const uid = Number(p.get("uid"));
  if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, "errors.badMessage");
  const r = await getRawSource(s, folder, uid);
  const name = (r.subject.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 80) || `message-${uid}`) + ".eml";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Uint8Array(r.content), {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Length": String(r.content.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
