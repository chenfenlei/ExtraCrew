import "./globals.css";

export const metadata = {
  title: "ExtraCrew — Connecting Students · Building Futures",
  description: "Find and join extracurricular groups, get AI-powered college advice, and connect with students who share your interests.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
