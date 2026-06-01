import type { Metadata } from "next";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3030";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "FocusFlow — Tu briefing matutino con IA",
  description:
    "Cada mañana recibes un email con el resumen de tu inbox de Gmail generado por IA. Empieza el día sabiendo qué importa.",
  applicationName: "FocusFlow",
  openGraph: {
    title: "FocusFlow",
    description: "Tu briefing matutino con IA",
    url: appUrl,
    siteName: "FocusFlow",
    locale: "es_ES",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FocusFlow",
    description: "Tu briefing matutino con IA",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
