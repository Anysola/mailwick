import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { MailApp } from "@/components/MailApp";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  // Read folder/message from the URL on the server too, so the first render matches the client (no hydration warning)
  const q = await searchParams;
  const f = typeof q.f === "string" && q.f ? q.f.slice(0, 500) : "INBOX";
  const m = Number(typeof q.m === "string" ? q.m : 0);
  return <MailApp email={s.email} initialFolder={f} initialUid={Number.isInteger(m) && m > 0 ? m : null} />;
}
