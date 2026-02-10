import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dupenet",
  description: "content ranked by economic commitment",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
