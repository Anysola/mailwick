import { json, route } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/compose";

export const GET = route(async (_req, s) => json(await getSettings(s)));
export const POST = route(async (req, s) => json(await saveSettings(s, await req.json())));
