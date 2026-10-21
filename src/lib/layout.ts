import { type Book, bookBySlug, books as allBooks, coverWidth, genreOf } from './books';

/**
 * Where every book sits. Each shelf belongs to one genre; the desk takes anything.
 * Everything here is measured in "base" pixels; the bookcase multiplies by a
 * scale factor so the same arrangement fits any screen.
 */
export type Orientation = 'spine' | 'cover';
export type Slot = { id: string; o: Orientation };
export type Shelf = { genre: string; slots: Slot[] };
export type Layout = { shelves: Shelf[]; desk: Slot[] };
export type ContainerId = number | 'desk';

/** Usable width of one shelf (and of the desk). */
export const SHELF_INNER = 780;
/** Horizontal space between neighbouring books. */
export const GAP = 3;
/** Books on the desk are drawn a little smaller. */
export const DESK_SCALE = 0.78;
/** Tallest a book can be, plus headroom: the height of a shelf compartment. */
export const SHELF_HEIGHT = 272;
const STORAGE_KEY = 'bookshelf-layout-v3';
/**
 * The books marked `display: true` when a layout was saved. If that list has
 * changed since, the saved arrangement is dropped so the new choice shows.
 */
const displayKey = (books: Book[]) =>
  books
    .filter((b) => b.display)
    .map((b) => b.slug)
    .sort()
    .join(',');
/** Shelves with spare room put books face-out until they're about this full. */
const DISPLAY_FILL = 0.7;

export function containerScale(c: ContainerId) {
  return c === 'desk' ? DESK_SCALE : 1;
}

/** Visible width of a book in a container (desk books always show their cover). */
export function slotWidth(book: Book, o: Orientation, c: ContainerId) {
  if (c === 'desk') return coverWidth(book) * DESK_SCALE;
  return o === 'spine' ? book.thickness : coverWidth(book);
}

export function outerWidth(book: Book, o: Orientation, c: ContainerId) {
  return slotWidth(book, o, c) + GAP;
}

/** Y-axis rotation of the 3D book: 90° shows the spine, ~0° shows the cover. */
export function restingAngle(o: Orientation, c: ContainerId) {
  if (c === 'desk') return 14;
  return o === 'spine' ? 90 : 0;
}

export const flipped = (o: Orientation): Orientation => (o === 'spine' ? 'cover' : 'spine');

export function getSlots(layout: Layout, c: ContainerId) {
  return c === 'desk' ? layout.desk : layout.shelves[c].slots;
}

export function usedWidth(slots: Slot[], c: ContainerId) {
  return slots.reduce((sum, s) => {
    const book = bookBySlug.get(s.id);
    return book ? sum + outerWidth(book, s.o, c) : sum;
  }, 0);
}

export function canFit(slots: Slot[], book: Book, o: Orientation, c: ContainerId) {
  return usedWidth(slots, c) + outerWidth(book, o, c) <= SHELF_INNER + 0.5;
}

/**
 * How a book dropped at `index` should stand. It follows its neighbours, like a
 * book slid in among spines or set out with a display; between a spine and a
 * cover it keeps `preferred`. If only the other way fits, it goes that way.
 */
export function placement(
  slots: Slot[],
  index: number,
  book: Book,
  c: ContainerId,
  preferred: Orientation,
  followNeighbours: boolean,
): Orientation | null {
  let o = preferred;
  if (followNeighbours) {
    const left = slots[index - 1]?.o;
    const right = slots[index]?.o;
    if (!left || !right || left === right) o = left ?? right ?? preferred;
  }
  if (canFit(slots, book, o, c)) return o;
  return canFit(slots, book, flipped(o), c) ? flipped(o) : null;
}

/** Whether a book may go in a container at all: shelves only take their own genre. */
export function accepts(layout: Layout, c: ContainerId, book: Book) {
  return c === 'desk' || layout.shelves[c].genre === genreOf(book);
}

export function containers(layout: Layout): ContainerId[] {
  return [...layout.shelves.map((_, i) => i), 'desk'];
}

export function findBook(layout: Layout, id: string) {
  for (const c of containers(layout)) {
    const index = getSlots(layout, c).findIndex((s) => s.id === id);
    if (index !== -1) return { c, index, slot: getSlots(layout, c)[index] };
  }
  return null;
}

export function removeBook(layout: Layout, id: string): Layout {
  return {
    shelves: layout.shelves.map((s) => ({ ...s, slots: s.slots.filter((slot) => slot.id !== id) })),
    desk: layout.desk.filter((slot) => slot.id !== id),
  };
}

export function insertBook(layout: Layout, c: ContainerId, index: number, slot: Slot): Layout {
  const next = removeBook(layout, slot.id);
  const list = [...getSlots(next, c)];
  list.splice(Math.min(index, list.length), 0, slot);
  if (c === 'desk') return { ...next, desk: list };
  return { ...next, shelves: next.shelves.map((s, i) => (i === c ? { ...s, slots: list } : s)) };
}

/** Turn a shelved book around where it stands, or null if there isn't room. */
export function turnBook(layout: Layout, id: string): Layout | null {
  const found = findBook(layout, id);
  if (!found || found.c === 'desk') return null;
  const o = flipped(found.slot.o);
  const others = getSlots(layout, found.c).filter((s) => s.id !== id);
  if (!canFit(others, bookBySlug.get(id)!, o, found.c)) return null;
  return insertBook(layout, found.c, found.index, { id, o });
}

/** Put a book spine-out on its genre's shelf, opening another shelf for the genre when full. */
function shelve(shelves: Shelf[], book: Book) {
  const genre = genreOf(book);
  let shelf = shelves.find((s, i) => s.genre === genre && canFit(s.slots, book, 'spine', i));
  if (!shelf) {
    shelf = { genre, slots: [] };
    shelves.push(shelf);
  }
  shelf.slots.push({ id: book.slug, o: 'spine' });
}

/** Shelves in alphabetical genre order (stable, so a genre's shelves keep their order). */
function sortShelves(shelves: Shelf[]) {
  return [...shelves].sort((a, b) => a.genre.localeCompare(b.genre));
}

/**
 * Turn books face-out. Books marked `display: true` come first, as long as the
 * shelf has room. On a shelf with none marked, books that leave `display` unset
 * are turned at evenly spread spots while the shelf has spare room, so a genre
 * with only a handful of books still looks like a display.
 */
function display(shelf: Shelf) {
  const bookAt = (i: number) => bookBySlug.get(shelf.slots[i].id)!;
  const turn = (i: number, limit: number) => {
    const book = bookAt(i);
    const grown = usedWidth(shelf.slots, 0) - outerWidth(book, 'spine', 0) + outerWidth(book, 'cover', 0);
    if (grown > limit) return false;
    shelf.slots[i] = { ...shelf.slots[i], o: 'cover' };
    return true;
  };

  const chosen = [...shelf.slots.keys()].filter((i) => bookAt(i).display);
  chosen.forEach((i) => turn(i, SHELF_INNER));
  if (chosen.length) return;

  const order = [...shelf.slots.keys()]
    .filter((i) => bookAt(i).display === undefined)
    .sort((a, b) => (a % 3) - (b % 3) || a - b);
  for (const i of order) {
    if (!turn(i, SHELF_INNER * DISPLAY_FILL)) break;
  }
}

/** A tidy starting arrangement: one shelf per genre, with spare room used for display. */
export function initialLayout(books: Book[]): Layout {
  const shelves: Shelf[] = [];
  for (const book of books) shelve(shelves, book);
  const sorted = sortShelves(shelves);
  sorted.forEach(display);
  return { shelves: sorted, desk: [] };
}

/**
 * Make a saved layout match the current books: drop books that are gone, move
 * books whose genre changed to the right shelf, shelve new books, and remove
 * shelves for genres that no longer have any books.
 */
function reconcile(saved: Layout, books: Book[]): Layout {
  const genres = new Set(books.map(genreOf));
  const placed = new Set<string>();
  const keep = (s: Slot, genre?: string) => {
    const book = bookBySlug.get(s.id);
    if (!book || placed.has(s.id) || (genre && genreOf(book) !== genre)) return false;
    placed.add(s.id);
    return true;
  };

  const shelves = saved.shelves
    .filter((s) => genres.has(s.genre))
    .map((s) => ({ genre: s.genre, slots: s.slots.filter((slot) => keep(slot, s.genre)) }));
  const desk = saved.desk.filter((slot) => keep(slot));

  const existing = new Set(shelves);
  for (const book of books) {
    if (!placed.has(book.slug)) shelve(shelves, book);
  }
  // Shelves opened just now (a new or renamed genre) get the same display as a fresh layout.
  shelves.filter((s) => !existing.has(s)).forEach(display);
  return { shelves: sortShelves(shelves), desk };
}

function isLayout(value: unknown): value is Layout {
  const v = value as Layout;
  const isSlot = (s: Slot) => !!s && typeof s.id === 'string' && (s.o === 'spine' || s.o === 'cover');
  return (
    !!v &&
    Array.isArray(v.shelves) &&
    v.shelves.every((s) => !!s && typeof s.genre === 'string' && Array.isArray(s.slots) && s.slots.every(isSlot)) &&
    Array.isArray(v.desk) &&
    v.desk.every(isSlot)
  );
}

export function loadLayout(books: Book[]): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (isLayout(saved) && (saved as { display?: string }).display === displayKey(books)) {
      return reconcile(saved, books);
    }
  } catch {
    // Storage unavailable or corrupt: fall through to a fresh arrangement.
  }
  return initialLayout(books);
}

export function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...layout, display: displayKey(allBooks) }));
  } catch {
    // Private mode or storage full: the arrangement just won't persist.
  }
}
