"use client";

/**
 * The last line of defence: an error in the root layout itself, where no
 * styling or navigation is available. Deliberately plain.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "48px 24px",
          color: "#12161b",
          background: "#f7f9fb",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          The app failed to start
        </h1>
        <p style={{ marginTop: 8, color: "#64757f", maxWidth: "42em" }}>
          Something went wrong before the page could render. Reloading usually
          fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "8px 14px",
            fontSize: 13,
            borderRadius: 3,
            border: "1px solid #c6d0d9",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
        {error.digest ? (
          <p style={{ marginTop: 24, fontSize: 12, color: "#64757f" }}>
            Reference {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
