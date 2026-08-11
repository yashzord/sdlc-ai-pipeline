import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SDLC AI Pipeline",
  description:
    "End-to-end AI-automated software delivery lifecycle: requirements → user stories → architecture → code → review → tests → release.",
  openGraph: {
    title: "SDLC AI Pipeline",
    description:
      "Watch an AI agent team take a product idea through the full software delivery lifecycle.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
