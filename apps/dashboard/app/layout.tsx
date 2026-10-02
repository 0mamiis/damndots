import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers, themeScript } from "@/components/theme";
export const metadata: Metadata = {
  title: "damndots · Kontrol paneli",
  description: "Kendi sunucunda çalışan Dots kontrol merkezi.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
