import type { Metadata } from "next";
import "./globals.css";
import "./education.css";

export const metadata: Metadata = {
  title: "وصل | Wasl",
  description: "إدارة منصة وصل · Wasl platform administration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
