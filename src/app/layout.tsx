import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

// Brand type (same as OneUp Insights): Inter Tight (headings + UI), Raleway
// (marketing prose), Geist Mono (numbers).
//
// Self-hosted from npm packages rather than next/font/google: the Google
// variant downloads the files during `next build`, and a failed fetch from
// Render's build machine failed the whole deploy.
const interTight = localFont({
  src: "../../node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2",
  variable: "--font-inter-tight",
  weight: "100 900",
  display: "swap",
});

const raleway = localFont({
  src: "../../node_modules/@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2",
  variable: "--font-raleway-src",
  weight: "100 900",
  display: "swap",
});

const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "OneUp Studio: OneUp Media content studio",
  description: "AI UGC production for OneUp Media: research, generation and review in one place.",
  icons: { icon: "/brand/oneup-logo.png" },
};

export const viewport = {
  colorScheme: "dark" as const,
  themeColor: "#0a1418",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${raleway.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        <TooltipProvider>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
