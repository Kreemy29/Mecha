import type { Metadata } from "next";
import { Inter_Tight, Raleway, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

// Brand type (same as OneUp Insights): Inter Tight (headings + UI), Raleway
// (marketing prose), Geist Mono (numbers).
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const raleway = Raleway({
  variable: "--font-raleway-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
