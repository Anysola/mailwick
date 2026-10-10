import { json } from "@/lib/api";
import { dropClient } from "@/lib/imap";
import { destroySession } from "@/lib/session";

export async function POST() {
  const id = await destroySession();
  if (id) dropClient(id);
  return json({ ok: true });
}
