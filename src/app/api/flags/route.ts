import { HttpError, json, route, str, uidSel } from "@/lib/api";
import { setFlags } from "@/lib/mail";

const FLAGS: Record<string, string> = { seen: "\\Seen", flagged: "\\Flagged" };

export const POST = route(async (req, s) => {
  const b = await req.json();
  const flag = FLAGS[b?.flag];
  if (!flag) throw new HttpError(400, "errors.badFlag");
  await setFlags(s, str(b.folder, 500), uidSel(b.uids), flag, b.value === true);
  return json({ ok: true });
});
