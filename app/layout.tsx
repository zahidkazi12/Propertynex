import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { MotionProvider } from "@/components/providers/MotionProvider";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PROPERTYNEX — Find. Invest. Belong.",
  description:
    "PROPERTYNEX is a modern real-estate marketplace connecting buyers, tenants, owners, agents, and builders. Discover, explore, and connect with real estate.",
  icons: {
    icon: "/images/favicon.svg",
  },
  openGraph: {
    title: "PROPERTYNEX — Find. Invest. Belong.",
    description:
      "Your smarter way to discover, explore, and connect with real estate.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is deliberately left enabled (no maximumScale / userScalable).
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans bg-navy-950 text-slate-100 antialiased">
        {/* Keyboard users can jump the navigation. Visually hidden until
            focused; every route renders a matching `#main-content`. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
            focus:rounded-lg focus:bg-navy-900 focus:px-4 focus:py-2.5 focus:text-sm
            focus:font-semibold focus:text-white focus:shadow-glow"
        >
          Skip to main content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
