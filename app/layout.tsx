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

// タイトルやセクションラベルに使うドット体。シオリのドット絵に合わせた書体
const displayFont = DotGothic16({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

// 初回描画より先に data-theme を確定させ、テーマのちらつきを防ぐ。
// 保存済みの選択があればそれを、無ければ OS の設定に従う。
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

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
    <html lang="ja" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} ${displayFont.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
