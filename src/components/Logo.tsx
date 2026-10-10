"use client";

import { useBrand } from "@/i18n/client";

/** Mailwick mark: an envelope with a small flame on its wick. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <path d="M50 2 C63 14 67 23 65 32 C63 40 57 45 50 45 C43 45 37 40 35 32 C34 25 38 20 44 15 C43 22 46 27 50 28 C53 20 54 11 50 2 Z" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 45 V52" />
        <rect x="14" y="52" width="72" height="40" rx="9" />
        <path d="M17 57 L50 77 L83 57" />
      </g>
    </svg>
  );
}

/** App logo: the instance's LOGO_URL when set, otherwise the Mailwick mark. */
export function Logo({ size = 28 }: { size?: number }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-[30%] object-contain" />;
  }
  return (
    <div className="grid shrink-0 place-items-center rounded-[30%] bg-accent text-accent-fg" style={{ width: size, height: size }}>
      <LogoMark className="h-[64%] w-[64%]" />
    </div>
  );
}
