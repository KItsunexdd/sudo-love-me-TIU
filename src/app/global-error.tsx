"use client";

function RecoveryScreen({ reset }: { reset: () => void }) {
  const { t, locale } = useT();
  return (
    <html lang={locale}>
      <body style={{ backgroundColor: "#131415", color: "#ECEEF0", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section
            role="alert"
            style={{
              maxWidth: "520px",
              width: "100%",
              borderRadius: "16px",
              border: "1px solid rgba(229, 72, 77, 0.45)",
              background: "#18191B",
              padding: "24px",
            }}
          >
            <p style={{ margin: 0, fontSize: "13px", fontFamily: "monospace", color: "#F07A7D" }}>
              ERR_GLOBAL_BOUNDARY
            </p>
            <h1 style={{ margin: "8px 0 12px", fontSize: "20px", fontWeight: 500 }}>
              {t("global-error.recover")}
            </h1>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#A2A6AD", lineHeight: 1.5 }}>
              {t("global-error.restartHint")}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#2FBF84",
                color: "#0E0F10",
                border: "none",
                borderRadius: "8px",
                padding: "10px 16px",
                fontWeight: 500,
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
