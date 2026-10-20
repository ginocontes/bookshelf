import { useEffect, useState } from 'react';

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SPINE_PALETTE = [
  '#7a2e2e', '#2f4f4f', '#1f3a5f', '#5a3e2b', '#3d5a40', '#6b4c7a',
  '#8a5a1f', '#24353f', '#7b3f52', '#3f4a6b', '#4e5d2f', '#9a4a2a',
];

export function fallbackColor(seed: string) {
  return SPINE_PALETTE[hashString(seed) % SPINE_PALETTE.length];
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex: string, amount: number) {
  const [r, g, b] = parseHex(hex);
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

export function isLight(hex: string) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

// Sampled cover colours are cached for the session so each image is read once.
const sampled = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function sampleImage(url: string): Promise<string | null> {
  if (sampled.has(url)) return Promise.resolve(sampled.get(url)!);
  if (pending.has(url)) return pending.get(url)!;

  const p = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 36;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 36);
        // Sample the left edge of the cover: that's what wraps around the spine.
        const { data } = ctx.getImageData(0, 0, 6, 36);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        resolve(toHex(r / n, g / n, b / n));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((color) => {
    sampled.set(url, color);
    pending.delete(url);
    return color;
  });

  pending.set(url, p);
  return p;
}

/** The spine colour for a book: explicit > sampled from cover > hashed palette. */
export function useSpineColor(seed: string, explicit?: string, coverUrl?: string) {
  const initial = explicit ?? (coverUrl && sampled.get(coverUrl)) ?? fallbackColor(seed);
  const [color, setColor] = useState(initial);

  useEffect(() => {
    if (explicit || !coverUrl) return;
    let alive = true;
    sampleImage(coverUrl).then((c) => alive && c && setColor(c));
    return () => {
      alive = false;
    };
  }, [explicit, coverUrl]);

  return color;
}
