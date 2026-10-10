import "server-only";
import type { Brand } from "@/i18n/client";

/** Instance branding from the environment (APP_NAME, LOGO_URL). */
export function getBrand(): Brand {
  const name = (process.env.APP_NAME || "Mailwick").trim().slice(0, 60) || "Mailwick";
  const logoUrl = process.env.LOGO_URL?.trim() || undefined;
  return { name, logoUrl };
}
