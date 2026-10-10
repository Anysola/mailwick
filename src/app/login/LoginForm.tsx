"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { Button, Checkbox, Icon, IconButton, TextField } from "@/components/ui";
import { useBrand, useT } from "@/i18n/client";

export function LoginForm({ domain }: { domain: string }) {
  const t = useT();
  const brand = useBrand();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const full = domain && !email.includes("@") ? `${email}@${domain}` : email;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: full, password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("login.failed"));
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-auto bg-bg px-4 py-10">
      <div className="absolute end-3 top-3">
        <LanguageMenu />
      </div>
      <div className="m3-dialog-in relative w-full max-w-[448px]">
        <form onSubmit={submit} className="rounded-[28px] bg-panel p-6 sm:p-10" noValidate>
          <div className="mb-8 flex flex-col items-start">
            <Logo size={48} />
            <h1 className="mt-6 type-headline-large">{t("login.title")}</h1>
            <p className="mt-2 type-body-large text-muted">{t("login.subtitle", { app: brand.name })}</p>
          </div>

          {error && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 type-body-medium text-on-danger-soft animate-fade">
              <Icon name="error" size={20} />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-6">
            <TextField
              label={t("login.email")}
              value={email}
              onChange={(v) => setEmail(v.trim())}
              leading="mail"
              suffix={domain && !email.includes("@") ? `@${domain}` : undefined}
              autoFocus
              autoComplete="username"
              inputMode="email"
              dir="ltr"
              required
            />
            <TextField
              label={t("login.password")}
              value={password}
              onChange={setPassword}
              type={show ? "text" : "password"}
              leading="lock"
              autoComplete="current-password"
              required
              trailing={
                <IconButton label={show ? t("login.hidePassword") : t("login.showPassword")} selected={show} onClick={() => setShow((v) => !v)}>
                  <Icon name={show ? "visibility_off" : "visibility"} />
                </IconButton>
              }
            />
          </div>

          <label className="-ms-2 mt-4 flex cursor-pointer select-none items-center gap-1 type-body-large text-fg">
            <Checkbox label={t("login.remember")} checked={remember} onChange={setRemember} />
            {t("login.remember")}
          </label>

          <Button type="submit" variant="filled" loading={busy} className="mt-8 h-12 w-full !type-label-large">
            {t("login.submit")}
            <Icon name="arrow_forward" size={20} />
          </Button>
        </form>

        <p className="mt-6 flex items-start justify-center gap-2 px-4 text-center type-body-small text-muted">
          <Icon name="shield_lock" size={16} className="mt-px" />
          <span>{t("login.note")}</span>
        </p>
      </div>
    </main>
  );
}
