import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Gym",
  description: "Micro-learning platform for banking sales teams",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
