import { parse as parseYaml } from 'yaml';
import { hashString } from './color';

export type Book = {
  slug: string;
  title: string;
  author: string;
  isbn?: string;
  cover?: string;
  /** Year of first publication; negative for BC. */
  published?: number;
  pages?: number;
  genre?: string;
  format?: string;
  rating?: number;
  started?: string;
  finished?: string;
  tags: string[];
  /** Optional explicit spine colour, otherwise sampled from the cover. */
  color?: string;
  /** Book height in base pixels (spine length). */
  height: number;
  /** Book thickness in base pixels (spine width). */
  thickness: number;
  review: string;
};

const sources = import.meta.glob('/content/books/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const coverFiles = import.meta.glob('/content/covers/*.{jpg,jpeg,png,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const localCovers = new Map(
  Object.entries(coverFiles).map(([path, url]) => [fileSlug(path), url]),
);

function fileSlug(path: string) {
  return path.split('/').pop()!.replace(/\.[^.]+$/, '');
}

function asDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function parseBook(path: string, raw: string): Book {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const data = ((match && parseYaml(match[1])) ?? {}) as Record<string, unknown>;
  const review = (match ? match[2] : raw).trim();
  const slug = fileSlug(path);
  const isbn = data.isbn != null ? String(data.isbn).replace(/-/g, '') : undefined;
  const pages = asNumber(data.pages);

  // `cover: false` means "no picture, draw one"; a string is an explicit URL.
  const cover =
    data.cover === false
      ? undefined
      : (typeof data.cover === 'string' && data.cover) ||
        localCovers.get(slug) ||
        (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : undefined);

  // Real books vary in height; derive a stable one from the slug unless given.
  const height = asNumber(data.height) ?? 210 + (hashString(slug) % 42);
  const thickness = Math.round(Math.min(64, Math.max(20, (pages ?? 250) * 0.085)));

  return {
    slug,
    title: String(data.title ?? slug),
    author: data.author ? String(data.author) : '',
    isbn,
    cover,
    published: asNumber(data.published),
    pages,
    genre: data.genre ? String(data.genre) : undefined,
    format: data.format ? String(data.format) : undefined,
    rating: asNumber(data.rating),
    started: asDate(data.started),
    finished: asDate(data.finished),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    color: typeof data.color === 'string' ? data.color : undefined,
    height,
    thickness,
    review,
  };
}

/** Books without a genre share a shelf called "Other". */
export function genreOf(book: Book) {
  return book.genre ?? 'Other';
}

/** First author's surname, for sorting and the spine. */
export function surname(book: Book) {
  const first = book.author.split(/,|&| and /)[0].trim();
  return first.split(' ').pop() ?? '';
}

/** All books, grouped by genre, then by author and title, like a tidy library. */
export const books: Book[] = Object.entries(sources)
  .map(([path, raw]) => parseBook(path, raw))
  .sort(
    (a, b) =>
      (a.genre ?? '~').localeCompare(b.genre ?? '~') ||
      surname(a).localeCompare(surname(b)) ||
      a.title.localeCompare(b.title),
  );

export const bookBySlug = new Map(books.map((b) => [b.slug, b]));

export const COVER_RATIO = 0.66;

export function coverWidth(book: Book) {
  return Math.round(book.height * COVER_RATIO);
}

export function formatYear(year?: number) {
  if (year == null) return undefined;
  return year < 0 ? `${-year} BC` : String(year);
}

export function daysToRead(book: Book): number | undefined {
  if (!book.started || !book.finished) return undefined;
  const ms = Date.parse(book.finished) - Date.parse(book.started);
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000) + 1) : undefined;
}

export function formatDate(iso?: string) {
  if (!iso) return undefined;
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
