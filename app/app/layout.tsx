import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "King County New Eats",
  description: "New restaurant openings in King County, WA.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
