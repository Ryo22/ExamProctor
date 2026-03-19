import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exam Proctor | Secure",
  description: "Offline proctoring system with secure proxying.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
