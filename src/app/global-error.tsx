"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// global-error.tsx captura errores de render que escapan a los error boundaries
// intermedios (incl. errores en el propio root layout). Es root level: renderiza
// su propio <html>/<body> porque NO hereda de layout.tsx.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafafa",
          color: "#1a1a1a",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: 600, padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Algo ha ido mal
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#475569", lineHeight: 1.5 }}>
            Hemos registrado el error y lo revisaremos. Vuelve a intentarlo en
            unos minutos.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "none",
              borderRadius: 6,
              background: "#0f172a",
              color: "#fff",
              padding: "0.6rem 1.25rem",
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            Recargar
          </button>
        </main>
      </body>
    </html>
  );
}
