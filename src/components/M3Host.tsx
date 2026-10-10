"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onDialogRequest, type DialogRequest } from "@/lib/dialog-service";
import { Button, Icon, Modal, TextField } from "./ui";
import { useT } from "@/i18n/client";

/**
 * Page-wide Material 3 behaviour:
 * - ripple on press for .sl elements
 * - plain tooltips for elements with data-tip
 * - confirmDialog / promptDialog windows
 */
export function M3Host() {
  useRipple();
  return (
    <>
      <Tooltip />
      <Dialogs />
    </>
  );
}

function useRipple() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const host = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".sl");
      if (!host || (host as HTMLButtonElement).disabled || host.getAttribute("aria-disabled") === "true") return;
      const r = host.getBoundingClientRect();
      const size = Math.hypot(r.width, r.height) * 2;
      const dot = document.createElement("span");
      dot.className = "sl-ripple";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left - size / 2}px`;
      dot.style.top = `${e.clientY - r.top - size / 2}px`;
      host.appendChild(dot);
      const start = performance.now();
      const release = () => {
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        // let the ripple grow for a minimum time even on a very short press
        const wait = Math.max(0, 225 - (performance.now() - start));
        setTimeout(() => {
          dot.classList.add("out");
          setTimeout(() => dot.remove(), 320);
        }, wait);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

type Tip = { text: string; x: number; y: number; below: boolean };

function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (el: HTMLElement, delay: number) => {
      const text = el.dataset.tip;
      if (!text) return;
      current.current = el;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 40 < window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 4 : r.top - 4, below });
      }, delay);
    };
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el !== current.current) show(el, 500);
      if (!el && current.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el.matches(":focus-visible")) show(el, 150);
      else hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="m3-tip-in pointer-events-none fixed z-[90] max-w-[260px] rounded-[4px] bg-inverse px-2 py-1 type-body-small text-inverse-fg"
      style={{
        left: Math.min(Math.max(8, tip.x), window.innerWidth - 8),
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
        transformOrigin: tip.below ? "top" : "bottom",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}

function Dialogs() {
  const t = useT();
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");

  useEffect(
    () =>
      onDialogRequest((r) => {
        setReq(r);
        setValue(r.kind === "prompt" ? r.initial || "" : "");
        setErr("");
      }),
    [],
  );

  const close = (answer: boolean) => {
    if (!req) return;
    if (req.kind === "confirm") req.resolve(answer);
    else {
      if (answer) {
        const problem = req.validate?.(value) ?? null;
        if (problem) {
          setErr(problem);
          return;
        }
      }
      req.resolve(answer ? value : null);
    }
    setReq(null);
  };

  const r = req;
  return (
    <Modal
      open={!!r}
      onClose={() => close(false)}
      title={r?.title || ""}
      width={r?.kind === "prompt" ? 440 : 400}
      icon={r?.kind === "confirm" && r.icon ? <Icon name={r.icon} size={24} className={r.danger ? "text-danger" : "text-secondary"} /> : undefined}
      footer={
        r && (
          <>
            <Button variant="text" onClick={() => close(false)}>{(r.kind === "confirm" && r.cancel) || t("common.cancel")}</Button>
            <Button variant={r.kind === "confirm" && r.danger ? "danger" : "filled"} onClick={() => close(true)}>
              {r.confirm || t("common.ok")}
            </Button>
          </>
        )
      }
    >
      {r?.kind === "confirm" && r.text && <p className="type-body-medium text-muted">{r.text}</p>}
      {r?.kind === "prompt" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(true);
          }}
          className="pt-2"
        >
          <TextField label={r.label} value={value} onChange={setValue} autoFocus error={err || undefined} surface="dialog" />
        </form>
      )}
    </Modal>
  );
}
