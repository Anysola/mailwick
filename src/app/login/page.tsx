import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getBrand } from "@/lib/brand";
import { env } from "@/lib/env";
import { getT } from "@/i18n/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("login.pageTitle", { app: getBrand().name }) };
}

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  // with exactly one allowed domain, people can type just the local part
  return <LoginForm domain={env.allowedDomains.length === 1 ? env.allowedDomains[0] : ""} />;
}
