import "./globals.css";

export const metadata = {
  title: "osu!ReqTrac - Request Tracker",
  description: "A self-hosted personal request tracker for osu! community requests.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
