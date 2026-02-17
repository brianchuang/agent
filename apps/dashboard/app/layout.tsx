import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Debug Dashboard",
  description: "Simple operational UI for agent runs and incidents"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
