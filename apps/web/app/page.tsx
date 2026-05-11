export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: -0.5 }}>
        AIfredo
      </h1>
      <p style={{ color: "#9aa1ad", lineHeight: 1.6 }}>
        Personal autonomous agent hub. Phase 0 — Telegram works, web UI lands later.
      </p>
      <p style={{ color: "#9aa1ad", lineHeight: 1.6 }}>
        Repo:{" "}
        <a
          href="https://github.com/zephan2000/AIfredo"
          style={{ color: "#7aa2f7" }}
        >
          github.com/zephan2000/AIfredo
        </a>
      </p>
    </main>
  );
}
