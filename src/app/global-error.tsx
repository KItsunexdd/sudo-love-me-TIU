"use client";

function RecoveryScreen({ reset }: { reset: () => void }) {
  const { t, locale } = useT();
  return (
    <html lang={locale}>
      <body style={{ backgroundColor: "#07110E", color: "#F0FDF8", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section
            role="alert"
            style={{
              maxWidth: "520px",
              width: "100%",
              borderRadius: "20px",
              border: "1px solid rgba(239, 68, 68, 0.55)",
              background: "#0D1B17",
              padding: "24px",
            }}
          >
            <p style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", color: "#FCA5A5" }}>
              ERR_GLOBAL_BOUNDARY
            </p>
            <h1 style={{ margin: "8px 0 12px", fontSize: "22px", fontWeight: 700 }}>
              {t("global-error.recover")}
            </h1>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#A7C4BA", lineHeight: 1.5 }}>
              {t("global-error.restartHint")}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#00D084",
                color: "#04120D",
                border: "none",
                borderRadius: "12px",
                padding: "12px 20px",
                fontWeight: 700,
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              {t("global-error.restart")}
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}import { LocaleProvider, useT } from "@/components/shell/LocaleProvider";


export default function GlobalError({ reset }: { reset: () => void }) {
  return <LocaleProvider standalone><RecoveryScreen reset={reset} /></LocaleProvider>;
}
