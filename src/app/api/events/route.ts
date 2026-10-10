import type { NextRequest } from "next/server";
import { newClient } from "@/lib/imap";
import { getSession } from "@/lib/session";

// Watches the open folder with IDLE and sends a "change" event to the browser.
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const folder = (req.nextUrl.searchParams.get("folder") || "INBOX").slice(0, 500);

  const client = newClient(s.email, s.password, { idle: true });
  const enc = new TextEncoder();
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let debounce: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(chunk));
        } catch {
          stop();
        }
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(debounce);
        client.logout().catch(() => {});
        try {
          ctrl.close();
        } catch {}
      };
      const changed = (kind: string) => () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => send(`event: change\ndata: ${JSON.stringify({ kind, folder })}\n\n`), 400);
      };
      req.signal.addEventListener("abort", stop);
      client.on("exists", changed("exists"));
      client.on("expunge", changed("expunge"));
      client.on("flags", changed("flags"));
      client.on("close", stop);
      client.on("error", stop);
      try {
        await client.connect();
        await client.mailboxOpen(folder, { readOnly: true });
        send(`retry: 5000\nevent: ready\ndata: {}\n\n`);
        timer = setInterval(() => send(`: ping\n\n`), 25_000);
      } catch {
        send(`event: fail\ndata: {}\n\n`);
        stop();
      }
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      client.logout().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
