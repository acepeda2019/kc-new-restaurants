import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Self-hosted at build time: visitors' browsers never call Google.
const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "King County New Eats",
  description: "New restaurant openings in King County, WA.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geist.className}>
      <body>{children}</body>
    </html>
  );
}
