import { HttpError, route, str } from "@/lib/api";
import { getAttachment } from "@/lib/mail";

const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain)$/i;

export const GET = route(async (req, s) => {
  const p = req.nextUrl.searchParams;
  const folder = str(p.get("folder"), 500);
  const uid = Number(p.get("uid"));
  const index = Number(p.get("index"));
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(index) || index < 0) throw new HttpError(400, "errors.badAttachment");
  const a = await getAttachment(s, folder, uid, index);
  const inline = p.get("inline") === "1" && PREVIEWABLE.test(a.contentType);
  const type = inline ? (a.contentType.startsWith("text/") ? "text/plain; charset=utf-8" : a.contentType) : "application/octet-stream";
  const ascii = a.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(a.content), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(a.content.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=600",
    },
  });
});
