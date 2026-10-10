import { json, route } from "@/lib/api";
import { getContacts } from "@/lib/mail";

export const GET = route(async (_req, s) => json({ contacts: await getContacts(s) }));
