import "server-only";
import sanitizeHtml from "sanitize-html";

const TAGS = [
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col",
  "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre",
  "q", "s", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "wbr", "style",
];

const COMMON = ["style", "class", "id", "align", "valign", "width", "height", "bgcolor", "color", "dir", "lang", "title", "border", "background"];

/** Removes remote CSS url(...) references while images are blocked. */
function stripCssUrls(css: string) {
  return css.replace(/url\s*\(\s*(['"]?)(?!\s*data:)[^)]*\1\s*\)/gi, "none").replace(/@import[^;]*;?/gi, "");
}

export type SanitizeOpts = {
  allowRemote: boolean;
  cidUrl: (cid: string) => string | null;
};

export function sanitizeEmail(html: string, opts: SanitizeOpts): { html: string; blocked: number } {
  let blocked = 0;
  const clean = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowVulnerableTags: true, // <style>: harmless thanks to the iframe sandbox + CSP
    nonTextTags: ["script", "textarea", "option", "noscript", "title", "style"],
    allowedAttributes: {
      "*": COMMON,
      a: [...COMMON, "href", "name", "target", "rel"],
      img: [...COMMON, "src", "alt", "data-blocked-src", "hspace", "vspace"],
      table: [...COMMON, "cellpadding", "cellspacing", "summary"],
      td: [...COMMON, "colspan", "rowspan", "nowrap"],
      th: [...COMMON, "colspan", "rowspan", "nowrap", "scope"],
      col: [...COMMON, "span"],
      font: [...COMMON, "face", "size"],
      blockquote: [...COMMON, "type", "cite"],
      ol: [...COMMON, "start", "type"],
      time: ["datetime"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
    allowedSchemesByTag: { a: ["http", "https", "mailto", "tel"], img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (tag, attribs) => {
        const src = (attribs.src || "").trim();
        const a = { ...attribs };
        if (/^cid:/i.test(src)) {
          const u = opts.cidUrl(src.slice(4).replace(/^<|>$/g, ""));
          if (u) a.src = u;
          else delete a.src;
        } else if (/^https?:/i.test(src) && !opts.allowRemote) {
          blocked++;
          a["data-blocked-src"] = src;
          delete a.src;
        } else if (src && !/^(https?:|data:image\/)/i.test(src)) {
          delete a.src;
        }
        return { tagName: "img", attribs: a };
      },
    },
  });

  let out = clean;
  if (!opts.allowRemote) {
    const before = out;
    out = out.replace(/style="([^"]*)"/gi, (_m, css: string) => `style="${stripCssUrls(css)}"`);
    out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, a: string, css: string) => `<style${a}>${stripCssUrls(css)}</style>`);
    out = out.replace(/\sbackground="https?:[^"]*"/gi, "");
    if (out !== before && blocked === 0) blocked = 1;
  }
  return { html: out, blocked };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Converts plain text to HTML with clickable links and dimmed quotes. */
export function textToHtml(text: string): string {
  const link = (l: string) =>
    l.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) out.push(`<div class="q">${quote.join("\n")}</div>`);
    quote = [];
  };
  for (const l of esc(text).split(/\r?\n/)) {
    if (/^&gt;/.test(l)) quote.push(link(l));
    else {
      flush();
      out.push(link(l));
    }
  }
  flush();
  // trim extra line breaks around block divs
  return `<div class="plain">${out.join("\n").replace(/\n<div class="q">/g, '<div class="q">').replace(/<\/div>\n/g, "</div>")}</div>`;
}

export function htmlToText(html: string): string {
  return sanitizeHtml(
    html
      .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li)[^>]*>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, ""),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stricter sanitizing for composed mail HTML (composer). */
export function sanitizeOutgoing(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["a", "b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "span", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "hr", "img", "table", "tbody", "thead", "tr", "td", "th", "font", "sub", "sup"],
    allowedAttributes: {
      "*": ["style", "dir"],
      a: ["href", "style", "target"],
      img: ["src", "alt", "width", "height", "style"],
      td: ["colspan", "rowspan", "style"],
      th: ["colspan", "rowspan", "style"],
      font: ["color", "face", "size"],
      blockquote: ["type", "style", "cite", "class"],
      div: ["class", "style", "dir"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
  });
}
