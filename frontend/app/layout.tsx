import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ClientProviders } from "@/lib/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dental Voice Receptionist",
  description: "Self-hosted AI phone receptionist for dental clinics.",
  keywords: ["dental AI", "AI receptionist", "self-hosted", "appointment booking", "voice AI"],
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.variable} font-sans antialiased`}>
        <ClientProviders>{children}</ClientProviders>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
