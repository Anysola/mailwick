"use client";

// M3 dialogs in place of the browser's confirm()/prompt() windows.
// M3Host listens and shows them; the caller awaits the answer via a Promise.

export type ConfirmOpts = { title: string; text?: string; confirm?: string; cancel?: string; danger?: boolean; icon?: string };
export type PromptOpts = { title: string; label: string; initial?: string; confirm?: string; validate?: (v: string) => string | null };

export type DialogRequest =
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmOpts)
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOpts);

type Listener = (r: DialogRequest) => void;
let listener: Listener | null = null;

export function onDialogRequest(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) return resolve(window.confirm(o.text ? `${o.title}\n\n${o.text}` : o.title));
    listener({ kind: "confirm", resolve, ...o });
  });
}

export function promptDialog(o: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(window.prompt(o.title, o.initial));
    listener({ kind: "prompt", resolve, ...o });
  });
}
