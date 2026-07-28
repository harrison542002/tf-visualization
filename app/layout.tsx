import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme/store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Terraform Visualizer",
  description: "Design cloud infrastructure on a canvas and export it as Terraform.",
};

/**
 * Sets the theme class before first paint.
 *
 * Without this the page renders light and then snaps to dark once React hydrates. It has to be
 * inline and synchronous in <head> for that reason, which is also why it is written defensively
 * — a throwing script here would block rendering entirely.
 */
const themeScript = `
(function(){try{
  var p = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) || "system";
  var dark = p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the script above changes the class list before React sees it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* h-full, not min-h-full: the canvas sizes itself from a chain of percentage and flex
          heights, and an auto-height body makes every one of them indefinite. */}
      <body className="flex h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
