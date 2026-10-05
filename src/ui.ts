export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const esc = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const clock = (t: number) => {
  const s = Math.floor(Math.max(0, t));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
export const uid = (prefix = 'id') => prefix + '-' + crypto.randomUUID();
let timer: ReturnType<typeof setTimeout>;
export function toast(text: string) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => ($('toast').hidden = true), 3800);
}
export function busy(text?: string) {
  $('loading').hidden = !text;
  $('unlockAudio').hidden = true;
  if (text) $('loadingText').textContent = text;
}
export async function fontReady(text: string) {
  await document.fonts.load(
    '400 18px "Noto Serif SC"',
    Array.from(new Set(Array.from(text))).join('') || '字里行间',
  );
}
export function drawWave(canvas: HTMLCanvasElement, peaks: number[], current = 0) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const c = canvas.getContext('2d')!;
  c.scale(dpr, dpr);
  c.clearRect(0, 0, width, height);
  c.fillStyle = '#9a9a9a';
  const step = width / Math.max(1, peaks.length);
  peaks.forEach((p, i) => {
    const h = Math.max(1, p * (height - 12));
    c.fillRect(i * step, (height - h) / 2, Math.max(0.7, step * 0.5), h);
  });
  c.fillStyle = '#171717';
  c.fillRect(Math.max(0, Math.min(1, current)) * width, 0, 1, height);
}
