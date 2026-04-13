import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ChatBotLoader from "@/components/ChatBotLoader";
import SidebarLayout from "@/components/SidebarLayout";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Ad Fatigue Monitor",
  description: "Detect ad fatigue early, before performance tanks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <SidebarLayout>{children}</SidebarLayout>
        <ChatBotLoader />
      </body>
    </html>
  );
}
