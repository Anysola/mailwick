import type { Metadata, Viewport } from "next";
import { Roboto_Flex } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { M3Host } from "@/components/M3Host";
import { I18nProvider } from "@/i18n/client";
import { isRtl } from "@/i18n/locales";
import { getT } from "@/i18n/server";
import { getBrand } from "@/lib/brand";

const roboto = Roboto_Flex({ subsets: ["latin", "latin-ext"], variable: "--font-roboto-flex", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrand();
  return {
    title: brand.name,
    robots: { index: false, follow: false },
    icons: brand.logoUrl ? { icon: brand.logoUrl } : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2fa" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b21" },
  ],
};

// Theme, color scheme and density are applied before first paint (no flash)
const themeScript = `try{var t=localStorage.getItem("mw-theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.dataset.theme=d?"dark":"light";var c=localStorage.getItem("mw-scheme-css");if(c){var s=document.createElement("style");s.id="mw-scheme";s.textContent=c;document.head.appendChild(s)}var a=JSON.parse(localStorage.getItem("mw-appearance")||"{}");h.dataset.density=a.density==="compact"?"compact":"default"}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, messages } = await getT();
  const brand = getBrand();
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className={`${roboto.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/material-symbols-rounded.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <I18nProvider locale={locale} messages={messages} brand={brand}>
          {children}
          <M3Host />
        </I18nProvider>
      </body>
    </html>
  );
}
