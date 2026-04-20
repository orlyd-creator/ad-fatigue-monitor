import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import SidebarLayout from "@/components/SidebarLayout";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "OD",
  description: "Your source of truth for ad performance, fatigue detection, and lead analytics",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Public viewers arrive via /public/<token>/route.ts which sets a
  // public_view httpOnly cookie. When present, hide write-only UI
  // (Refresh, Share workspace, Switch Account) so viewers don't hit 401s.
  const jar = await cookies();
  const isPublic = Boolean(jar.get("public_view")?.value);

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <SidebarLayout isPublic={isPublic}>{children}</SidebarLayout>
      </body>
    </html>
  );
}
