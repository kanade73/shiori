import type { Metadata } from "next";
import { Noto_Sans_JP, JetBrains_Mono, DotGothic16 } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// 小さなラベル（話者名・時刻・見出しの添え字・ボタン）にだけ使うドットフォント。
// 本文まで置き換えると読みづらくなるので、本文は Noto Sans JP のまま
const pixel = DotGothic16({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "そんなシーンあった？",
  description: "二周目のアニメ視聴者向けチャットアプリ。シオリが本物の設定に小さな嘘を混ぜて返答します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" data-theme="dark">
      <body className={`${sans.variable} ${mono.variable} ${pixel.variable}`}>{children}</body>
    </html>
  );
}
