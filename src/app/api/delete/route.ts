import { json, route, str, uidSel } from "@/lib/api";
import { deleteMessages } from "@/lib/mail";

export const POST = route(async (req, s) => {
  const b = await req.json();
  return json(await deleteMessages(s, str(b?.folder, 500), uidSel(b?.uids)));
});
