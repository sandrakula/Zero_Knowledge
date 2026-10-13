import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { I18nProvider } from "@/components/i18n";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cognos — Learning Intelligence Platform",
  description:
    "An adaptive learning intelligence system: a living model of what you know, a roadmap built for you, and evidence-driven next steps.",
};

export const viewport: Viewport = {
  themeColor: "#08080d",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">
        <div className="app-bg" />
        <div className="app-grid" />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
