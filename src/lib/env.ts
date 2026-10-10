import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const flag = (name: string) => process.env[name] === "1" || process.env[name] === "true";

export const env = {
  get secret() {
    const s = req("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379/0",
  redisPrefix: process.env.REDIS_PREFIX || "mailwick:",
  get imapHost() {
    return req("IMAP_HOST");
  },
  imapPort: Number(process.env.IMAP_PORT || 993),
  // 993: implicit TLS; 143: STARTTLS (always required, plain-text logins are refused)
  get imapSecure() {
    return process.env.IMAP_SECURE ? flag("IMAP_SECURE") : this.imapPort === 993;
  },
  get smtpHost() {
    return process.env.SMTP_HOST || this.imapHost;
  },
  smtpPort: Number(process.env.SMTP_PORT || 465),
  // 465: implicit TLS; 587: STARTTLS
  get smtpSecure() {
    return process.env.SMTP_SECURE ? flag("SMTP_SECURE") : this.smtpPort === 465;
  },
  // Only for local test servers with self-signed certificates
  tlsInsecure: flag("TLS_INSECURE"),
  // Behind a reverse proxy: take the client IP from X-Forwarded-For / X-Real-IP / CF-Connecting-IP
  trustProxy: flag("TRUST_PROXY"),
  allowedDomains: (process.env.ALLOWED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean),
};
