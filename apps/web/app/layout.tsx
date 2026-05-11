import type { ReactNode } from "react";

export const metadata = {
  title: "AIfredo",
  description: "Personal autonomous agent hub",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          margin: 0,
          background: "#0f1115",
          color: "#e7e9ee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
