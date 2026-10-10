import { json, route, str } from "@/lib/api";
import { listMessages, searchAllFolders, type ListFilter } from "@/lib/mail";

export const GET = route(async (req, s) => {
  const p = req.nextUrl.searchParams;
  const folder = str(p.get("folder") || "INBOX", 500);
  const page = Math.max(0, Math.min(10_000, Number(p.get("page")) || 0));
  const q = (p.get("q") || "").trim().slice(0, 200);
  const f = p.get("filter");
  const filter: ListFilter = f === "unread" || f === "flagged" ? f : "all";
  if (p.get("scope") === "all" && q) return json(await searchAllFolders(s, page, q, filter));
  return json(await listMessages(s, folder, page, q, filter));
});
