import "./globals.css";

// Render on every request so the HTML shell always references the current
// deploy's chunk hashes (combined with no-cache headers in next.config.js,
// this prevents the "stale until hard reload" issue after a Vercel deploy).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

export const metadata = {
  title: "ExtraCrew",
  description: "Connecting Students · Building Futures",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
