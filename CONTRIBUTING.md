# Contributing to Mailwick

Thanks for helping out! Bug reports, translations and pull requests are all welcome.

## Reporting bugs

Open an issue with:

- what you did, what you expected and what happened instead;
- your mail server (Stalwart, Dovecot, Gmail, …), as IMAP servers differ in subtle ways;
- browser and Mailwick version.

Never paste passwords, session cookies or real message content into an issue. For security problems, follow [SECURITY.md](SECURITY.md) instead.

## Translations

UI strings live in `src/i18n/messages/<code>.json`, and `en.json` is the source of truth.

- Keep `{placeholders}` exactly as they are.
- Plural strings are objects keyed by CLDR categories (`one`, `few`, `many`, `other`). Include every category your language uses.
- Run `npm run i18n:check` before opening a pull request.

## Code

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm run i18n:check
npm run build
```

Guidelines:

- **Every user-facing string goes through i18n.** Use `useT()` in components, `t()` from `@/i18n/client` in browser-only code, and `HttpError(status, "errors.key")` on the server. Add new keys to `en.json`. Other languages fall back to English until they are translated.
- **Use logical CSS** (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, `text-start`) so right-to-left languages keep working.
- **Follow the existing Material 3 language.** Reuse the components in `src/components/ui.tsx` and the color tokens in `globals.css`.
- **New icons:** add the name to `src/lib/icon-names.json` and run `npm run icons`.
- **Keep it a client.** Mailwick talks to IMAP/SMTP and stores nothing but sessions and small per-user settings in Redis.

By contributing you agree that your contributions are licensed under the AGPL-3.0-or-later.
