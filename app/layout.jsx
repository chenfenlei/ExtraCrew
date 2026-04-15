import "./globals.css";

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
