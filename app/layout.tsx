import type { Metadata, Viewport } from "next";
import "./globals.css";
import Pwa from "./components/pwa";
export const metadata: Metadata = {
  title: "Portfolio",
  description: "Private read-only investing dashboard",
  applicationName: "Portfolio",
  appleWebApp: {
    capable: true,
    title: "Portfolio",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/portfolio-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: "#0b111d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
