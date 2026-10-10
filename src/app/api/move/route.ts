import { json, route, str, uidSel } from "@/lib/api";
import { moveMessages } from "@/lib/mail";

export const POST = route(async (req, s) => {
  const b = await req.json();
  return json(await moveMessages(s, str(b?.folder, 500), uidSel(b?.uids), str(b?.to, 500)));
});
