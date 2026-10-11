"use client";

import { useEffect, useRef, useState } from "react";
import { t as translate, useT } from "@/i18n/client";

const QUOTE_SEL = ".plain > .q, .mw-attr + blockquote, .gmail_quote, blockquote[type=cite], .mw-quote, .yahoo_quoted, #divRplyFwdMsg, .moz-cite-prefix";

function frameDoc(html: string, opts: { images: boolean; plain: boolean; dark: boolean }) {
  const img = opts.images ? "https: http: data: 'self'" : "data: 'self'";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:${opts.images ? " https:" : ""}; media-src 'none'; frame-src 'none'; form-action 'none'`;
  const fg = opts.plain && opts.dark ? "#e4e1e9" : "#1b1b21";
  const link = opts.plain && opts.dark ? "#bfc1ff" : "#4c52c7";
  // must match the iframe's own color-scheme, otherwise the browser paints an opaque (white) backdrop behind it
  const scheme = opts.plain && opts.dark ? "dark" : "light";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="${scheme}"><base target="_blank"><style>
:root{color-scheme:${scheme}}
html,body{margin:0;padding:0;background:transparent}
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${fg};word-wrap:break-word;overflow-wrap:anywhere;overflow-y:hidden;display:flow-root}
a{color:${link}}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
.plain{white-space:pre-wrap;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.plain .q{color:${opts.dark && opts.plain ? "#8d8d99" : "#777"}}
blockquote{margin-block:.5em;margin-inline:.4em 0;padding-inline-start:.9em;border-inline-start:3px solid ${opts.dark && opts.plain ? "#46464f" : "#c7c5d0"};color:inherit}
img[data-blocked-src]{display:inline-block;min-width:16px;min-height:16px;background:repeating-linear-gradient(45deg,#f2f2f5,#f2f2f5 6px,#e9e9ee 6px,#e9e9ee 12px);border-radius:4px}
.mw-hidden{display:none!important}
.mw-toggle{display:inline-flex;align-items:center;justify-content:center;height:18px;padding:0 8px;margin:6px 0;border:1px solid ${opts.dark && opts.plain ? "#33333d" : "#dcdce2"};border-radius:9px;background:${opts.dark && opts.plain ? "#1d1d23" : "#f4f4f7"};color:#888;font:700 12px/1 sans-serif;letter-spacing:1px;cursor:pointer}
.mw-toggle:hover{background:${opts.dark && opts.plain ? "#26262e" : "#e9e9ef"};color:#555}
</style></head><body dir="auto">${html}</body></html>`;
}

export function MailFrame({
  html,
  images,
  plain,
  dark,
  onMailto,
}: {
  html: string;
  images: boolean;
  plain: boolean;
  dark: boolean;
  onMailto: (address: string, subject?: string) => void;
}) {
  const tr = useT();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const mailtoRef = useRef(onMailto);
  mailtoRef.current = onMailto;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | undefined;
    const timers: number[] = [];

    const resize = () => {
      const d = frame.contentDocument;
      if (!d?.body) return;
      // documentElement.scrollHeight never drops below the iframe height; measure the body instead
      const h = Math.max(d.body.scrollHeight, Math.ceil(d.body.getBoundingClientRect().height));
      setHeight(Math.min(Math.max(h + 2, 40), 60_000));
    };

    const onLoad = () => {
      const d = frame.contentDocument;
      if (!d) return;
      // collapse the quoted part (when there is content before it)
      const q = d.querySelector(QUOTE_SEL);
      if (q && q.parentElement) {
        const before = (d.body.innerText || "").split((q as HTMLElement).innerText || "\u0000")[0];
        if (before.trim().length > 0) {
          const hide: Element[] = [q];
          let n = q.nextElementSibling;
          while (n) {
            hide.push(n);
            n = n.nextElementSibling;
          }
          const prev = q.previousElementSibling;
          if (prev && /(wrote|schrieb|a écrit|escribió|ha scritto|escreveu|schreef|napisał|написал|yazdı|skrev|kirjoitti|έγραψε|写道|寫道|님이 작성):?\s*$/i.test((prev as HTMLElement).innerText || "")) hide.unshift(prev);
          hide.forEach((e) => e.classList.add("mw-hidden"));
          const btn = d.createElement("div");
          btn.className = "mw-toggle";
          btn.title = translate("reader.showQuote");
          btn.textContent = "•••";
          btn.addEventListener("click", () => {
            const hidden = hide[0].classList.contains("mw-hidden");
            hide.forEach((e) => e.classList.toggle("mw-hidden", !hidden));
            btn.title = hidden ? translate("reader.hideQuote") : translate("reader.showQuote");
            resize();
          });
          hide[0].parentElement!.insertBefore(btn, hide[0]);
        }
      }
      // open mailto: links in our own composer
      d.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement)?.closest?.("a");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (href.toLowerCase().startsWith("mailto:")) {
          e.preventDefault();
          const u = new URL(href);
          mailtoRef.current(decodeURIComponent(u.pathname), u.searchParams.get("subject") || undefined);
        }
      });
      // keep keyboard shortcuts working after clicking inside the message
      d.addEventListener("keydown", (e) => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }),
        );
      });
      d.querySelectorAll("img").forEach((img) => img.addEventListener("load", resize));
      resize();
      try {
        ro = new ResizeObserver(resize);
        ro.observe(d.body);
      } catch {}
      [100, 400, 1200, 3000].forEach((t) => timers.push(window.setTimeout(resize, t)));
    };

    frame.addEventListener("load", onLoad);
    frame.srcdoc = frameDoc(html, { images, plain, dark });
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [html, images, plain, dark]);

  return (
    <iframe
      ref={ref}
      title={tr("reader.frameTitle")}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border-0"
      style={{ height, colorScheme: plain && dark ? "dark" : "light" }}
    />
  );
}
