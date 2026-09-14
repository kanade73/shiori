/** 表示用の時刻 "H:MM"。不正な ISO 文字列なら空文字 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}
