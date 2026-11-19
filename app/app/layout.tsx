import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Self-hosted at build time: visitors' browsers never call Google.
const geist = Geist({ subsets: ["latin"] });

const DESCRIPTION = "What just opened near you in King County, WA. Ask, and the map shows you.";

// The preview when the link is shared (SAN-54). Crawlers can't pass the passcode, so they read
// these tags on /login; the image and icons they point to are public (proxy.ts).
export const metadata: Metadata = {
  metadataBase: new URL("https://kc-new-restaurants.vercel.app"),
  title: "King County New Eats",
  description: DESCRIPTION,
  openGraph: { title: "King County New Eats", description: DESCRIPTION, siteName: "King County New Eats", type: "website" },
  twitter: { card: "summary_large_image", title: "King County New Eats", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geist.className}>
      <body>{children}</body>
    </html>
  );
}
