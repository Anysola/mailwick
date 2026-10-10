import "server-only";
import type { SearchObject } from "imapflow";

// Converts search box operators into an IMAP SEARCH query.
// English operators are canonical: from: to: cc: subject: has:attachment is:unread|read|starred before: after: on: larger: smaller:
// Some localized (Turkish) aliases are accepted too, e.g. kimden: kime: konu: önce: sonra: ek:var okunmamış/yıldızlı

const KEYS: Record<string, string> = {
  from: "from", kimden: "from", gönderen: "from",
  to: "to", kime: "to", alıcı: "to",
  cc: "cc", bilgi: "cc",
  subject: "subject", konu: "subject",
  has: "has", ek: "has",
  is: "is", durum: "is",
  before: "before", önce: "before",
  after: "since", since: "since", sonra: "since",
  on: "on", tarih: "on",
  larger: "larger", büyük: "larger",
  smaller: "smaller", küçük: "smaller",
};

function parseDate(v: string): Date | null {
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function parseSize(v: string): number | null {
  const m = v.toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(k|kb|m|mb|g|gb)?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = m[2]?.[0];
  return Math.round(n * (unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : unit === "g" ? 1024 ** 3 : 1));
}

export type ParsedSearch = { query: SearchObject; words: string; hasOperators: boolean };

export function parseSearch(raw: string): ParsedSearch {
  const query: SearchObject = {};
  const words: string[] = [];
  let hasOperators = false;
  const re = /([^\s:"]+):("([^"]*)"|\S+)|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) {
      const key = KEYS[m[1].toLocaleLowerCase("tr")];
      const val = (m[3] !== undefined ? m[3] : m[2]).trim();
      if (!key || !val) {
        words.push(m[0]);
        continue;
      }
      hasOperators = true;
      const low = val.toLocaleLowerCase("tr");
      switch (key) {
        case "from":
        case "to":
        case "cc":
        case "subject":
          query[key] = val;
          break;
        case "has":
          // IMAP has no direct "has attachment" search; a multipart/mixed header is a good enough approximation
          if (/^(attachment|attachments|ek|var|dosya)$/.test(low)) query.header = { ...(query.header || {}), "content-type": "multipart/mixed" };
          else words.push(m[0]);
          break;
        case "is":
          if (/^(unread|unseen|okunmamış|okunmamis|yeni)$/.test(low)) query.seen = false;
          else if (/^(read|seen|okunmuş|okunmus)$/.test(low)) query.seen = true;
          else if (/^(starred|flagged|yıldızlı|yildizli)$/.test(low)) query.flagged = true;
          else if (/^(unstarred|yıldızsız)$/.test(low)) query.flagged = false;
          else if (/^(answered|yanıtlanmış|yanitlanmis)$/.test(low)) query.answered = true;
          else words.push(m[0]);
          break;
        case "before":
        case "since":
        case "on": {
          const d = parseDate(val);
          if (d) query[key] = d;
          else words.push(m[0]);
          break;
        }
        case "larger":
        case "smaller": {
          const n = parseSize(val);
          if (n !== null) query[key] = n;
          else words.push(m[0]);
          break;
        }
      }
    } else if (m[4] !== undefined) {
      if (m[4].trim()) words.push(m[4].trim());
    } else if (m[5] !== undefined) words.push(m[5]);
  }
  const text = words.join(" ").trim();
  if (text) query.text = text;
  return { query, words: text, hasOperators };
}
