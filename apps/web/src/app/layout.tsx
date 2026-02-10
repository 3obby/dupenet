import type { Metadata } from "next";
import { KeyProvider } from "@/components/KeyProvider";
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
      <body>
        <KeyProvider>{children}</KeyProvider>
      </body>
    </html>
  );
}
