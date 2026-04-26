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

// Inline boot shell — server-rendered into the initial HTML so the user sees a
// branded loading screen the moment the document parses, BEFORE the JS bundle
// downloads/hydrates. The React tree removes this node from AppShell once the
// auth bootstrap has decided what to render (BootStateOverlay, AuthScreen, or
// the app itself). Inline styles are used so this is independent of globals.css
// loading order — no font / external CSS needed for first paint.
const bootShellStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  background: "#f3efe6",
  color: "#0c1422",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  textAlign: "center",
  padding: "1rem",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="boot-shell" aria-hidden="true" style={bootShellStyle}>
          <div style={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: ".04em", lineHeight: 1 }}>
            EXTRA<span style={{ color: "#d97a2c" }}>CREW</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", color: "#6b6660" }}>
            <span
              style={{
                width: 14,
                height: 14,
                border: "2.5px solid #ddd5c4",
                borderTopColor: "#d97a2c",
                borderRadius: "50%",
                display: "inline-block",
                animation: "ec-boot-spin .6s linear infinite",
              }}
            />
            <span style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
              Restoring session…
            </span>
          </div>
          <style
            dangerouslySetInnerHTML={{
              __html: "@keyframes ec-boot-spin{to{transform:rotate(360deg)}}",
            }}
          />
        </div>
        {children}
      </body>
    </html>
  );
}
