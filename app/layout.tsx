import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./packet.css";
import { Providers } from "./providers";

// Distinctive editorial pairing per the frontend-aesthetics ruleset (no Inter/Roboto/Arial/system):
// Fraunces is a characterful display serif for headings; Hanken Grotesk a clean humanist body sans.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Monospace kept for code/token display in the app form (mono-for-data is not the aesthetic concern).
const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ScoutLane: Application Packet",
  description:
    "Paste a resume and a job description to generate a fit assessment plus a tailored, ATS-safe resume and cover letter, built only from your real history.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
