import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'motion/react';
import { useNavigate } from 'react-router';
import { Book3D } from './Book3D';
import { type Book, bookBySlug, coverWidth, genreOf } from '../lib/books';
import {
  accepts,
  canFit,
  containers,
  containerScale,
  findBook,
  flipped,
  getSlots,
  GAP,
  insertBook,
  outerWidth,
  placement,
  restingAngle,
  SHELF_HEIGHT,
  SHELF_INNER,
  slotWidth,
  turnBook,
  DESK_SCALE,
  type ContainerId,
  type Orientation,
  type Layout,
  type Slot,
} from '../lib/layout';
import { useShelf } from '../state/ShelfContext';

type Target = { c: ContainerId; index: number };

type Drag = {
  id: string;
  pointerId: number;
  origin: Target & { o: Orientation };
  /** How the book will stand if dropped on a shelf. */
  placeO: Orientation;
  /** Set once the reader turns the book themselves; until then it follows its neighbours. */
  manual: Orientation | null;
  /** Where the gap is opened, or null when hovering nowhere useful. */
  target: Target | null;
  /** A container the book was dragged over but doesn't fit in. */
  blocked: ContainerId | null;
  phase: 'holding' | 'landing';
};

type Press = { id: string; x: number; y: number; pointerId: number; el: HTMLElement };

const LAYOUT_SPRING = { type: 'spring', stiffness: 520, damping: 42 } as const;
const LIFT_SPRING = { type: 'spring', stiffness: 260, damping: 24 } as const;
const LAND_SPRING = { type: 'spring', stiffness: 300, damping: 32, restDelta: 0.5 } as const;
const TURN_SPRING = { stiffness: 210, damping: 22 };
const DRAG_THRESHOLD = 6;
/** Holding a finger still on a book for this long turns it (touch screens have no hover button). */
const LONG_PRESS = 450;
/** Width of the wooden divider between the two bookcase columns on wide screens. */
const COLUMN_GAP = 22;
const TWO_COLUMNS_FROM = 1100;

const sameTarget = (a: Target | null, b: Target | null) =>
  a === b || (!!a && !!b && a.c === b.c && a.index === b.index);

export function Bookcase() {
  const { layout, setLayout, lastOpened, setLastOpened } = useShelf();
  const navigate = useNavigate();

  const measureRef = useRef<HTMLDivElement>(null);
  const { scale, cols } = useCaseScale(measureRef);
  const rows = useRef(new Map<ContainerId, HTMLDivElement>());
  const zones = useRef(new Map<ContainerId, HTMLDivElement>());

  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pressRef = useRef<Press | null>(null);
  const layoutRef = useRef(layout);
  const scaleRef = useRef(scale);
  layoutRef.current = layout;
  scaleRef.current = scale;

  // The floating book: pointer position, grab offset, lift scale and turn angle.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const offX = useMotionValue(0);
  const offY = useMotionValue(0);
  const size = useMotionValue(1);
  const angle = useMotionValue(90);

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  /** Which container is under the pointer, and at what index the book would go. */
  const hitTest = (x: number, y: number, d: Drag): Pick<Drag, 'target' | 'blocked' | 'placeO'> => {
    const current = layoutRef.current;
    const s = scaleRef.current;
    const book = bookBySlug.get(d.id)!;

    // The container under the pointer; failing that, one within a small margin of it.
    let hit: ContainerId | undefined;
    let nearest = 48;
    for (const id of containers(current)) {
      const zone = zones.current.get(id)?.getBoundingClientRect();
      if (!zone || y < zone.top || y > zone.bottom) continue;
      const distance = Math.max(zone.left - x, x - zone.right, 0);
      if (distance <= nearest) {
        hit = id;
        nearest = distance;
        if (distance === 0) break;
      }
    }
    const row = hit != null ? rows.current.get(hit)?.getBoundingClientRect() : undefined;
    const nowhere = { target: null, placeO: d.placeO };
    if (hit == null || !row) return { ...nowhere, blocked: null };
    const c = hit;

    const slots = getSlots(current, c).filter((sl) => sl.id !== d.id);
    if (!accepts(current, c, book)) return { ...nowhere, blocked: c };

    // Count the books whose *visible* centre is left of the pointer. Taking the
    // currently open gap into account keeps the gap from flickering back and forth.
    const gapAt = d.target?.c === c ? d.target.index : -1;
    const gapO = c === 'desk' ? 'cover' : d.placeO;
    let cursor = row.left;
    let index = 0;
    slots.forEach((sl, i) => {
      if (i === gapAt) cursor += outerWidth(book, gapO, c) * s;
      const width = slotWidth(bookBySlug.get(sl.id)!, sl.o, c) * s;
      if (cursor + width / 2 < x) index = i + 1;
      cursor += width + GAP * s;
    });

    if (c === 'desk') {
      return canFit(slots, book, 'cover', c) ? { target: { c, index }, blocked: null, placeO: d.placeO } : { ...nowhere, blocked: c };
    }
    // Put back exactly where it came from, a book keeps standing the way it did.
    const home = !d.manual && sameTarget({ c, index }, d.origin);
    const o = home ? d.origin.o : placement(slots, index, book, c, d.manual ?? d.placeO, !d.manual);
    return o ? { target: { c, index }, blocked: null, placeO: o } : { ...nowhere, blocked: c };
  };

  const beginDrag = (press: Press, e: PointerEvent) => {
    const found = findBook(layoutRef.current, press.id);
    const slotEl = press.el.querySelector('.slot-book');
    if (!found || !slotEl) return;

    const book = bookBySlug.get(press.id)!;
    const s = scaleRef.current;
    const k = containerScale(found.c);
    const rect = slotEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.bottom - (book.height * k * s) / 2;

    px.set(e.clientX);
    py.set(e.clientY);
    offX.set(e.clientX - cx);
    offY.set(e.clientY - cy);
    size.set(k);
    angle.set(restingAngle(found.slot.o, found.c));

    setDrag({
      id: press.id,
      pointerId: press.pointerId,
      origin: { c: found.c, index: found.index, o: found.slot.o },
      placeO: found.slot.o,
      manual: null,
      target: { c: found.c, index: found.index },
      blocked: null,
      phase: 'holding',
    });

    // Pull the book out: grow it, turn the cover towards the viewer and hold it
    // a little above the pointer so the drop position stays visible.
    const lift = Math.min(2.2, Math.max(1.15, 320 / (book.height * s)));
    animate(size, lift, LIFT_SPRING);
    animate(angle, 22, LIFT_SPRING);
    animate(offX, 0, LIFT_SPRING);
    animate(offY, book.height * s * lift * 0.32, LIFT_SPRING);
  };

  const retarget = (d: Drag) => {
    const next = hitTest(px.get(), py.get(), d);
    if (
      d !== dragRef.current ||
      !sameTarget(next.target, d.target) ||
      next.blocked !== d.blocked ||
      next.placeO !== d.placeO
    ) {
      setDrag({ ...d, ...next });
    }
  };

  const flip = (d: Drag) => retarget({ ...d, placeO: flipped(d.placeO), manual: flipped(d.placeO) });

  /** Turn a shelved book around in place. */
  const turn = (id: string) => {
    const next = turnBook(layoutRef.current, id);
    if (next) setLayout(next);
    else navigator.vibrate?.([20, 40, 20]);
  };

  /** Fly the book into its gap (or back home), then commit the new layout. */
  const drop = (d: Drag) => {
    const target = d.target ?? { c: d.origin.c, index: d.origin.index };
    const o = d.target ? d.placeO : d.origin.o;
    setDrag({ ...d, target, placeO: o, blocked: null, phase: 'landing' });

    const book = bookBySlug.get(d.id)!;
    const s = scaleRef.current;
    const { c, index } = target;
    const row = rows.current.get(c)!.getBoundingClientRect();
    const others = getSlots(layoutRef.current, c).filter((sl) => sl.id !== d.id);
    let left = row.left;
    for (const sl of others.slice(0, index)) left += outerWidth(bookBySlug.get(sl.id)!, sl.o, c) * s;

    const cx = left + (slotWidth(book, o, c) * s) / 2;
    const cy = row.bottom - (book.height * containerScale(c) * s) / 2;

    Promise.all([
      animate(px, cx, LAND_SPRING),
      animate(py, cy, LAND_SPRING),
      animate(offX, 0, LAND_SPRING),
      animate(offY, 0, LAND_SPRING),
      animate(size, containerScale(c), LAND_SPRING),
      animate(angle, restingAngle(o, c), LAND_SPRING),
    ]).then(() => {
      setLayout(insertBook(layoutRef.current, c, index, { id: d.id, o }));
      setDrag(null);
    });
  };

  const open = (id: string) => {
    flushSync(() => setLastOpened(id));
    navigate(`/book/${id}`, { viewTransition: true });
  };

  const handlers = { beginDrag, retarget, flip, drop, open, turn };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let lastWheel = 0;
    const holding = () => (dragRef.current?.phase === 'holding' ? dragRef.current : null);

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        if (d.phase === 'holding' && e.pointerId === d.pointerId) {
          px.set(e.clientX);
          py.set(e.clientY);
          handlersRef.current.retarget(d);
        }
        return;
      }
      const press = pressRef.current;
      if (press && e.pointerId === press.pointerId) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
          pressRef.current = null;
          handlersRef.current.beginDrag(press, e);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = holding();
      if (d) {
        if (e.pointerId === d.pointerId) handlersRef.current.drop(d);
        return;
      }
      const press = pressRef.current;
      pressRef.current = null;
      if (press && e.pointerId === press.pointerId) handlersRef.current.open(press.id);
    };
    const onCancel = (e: PointerEvent) => {
      pressRef.current = null;
      const d = holding();
      if (d && e.pointerId === d.pointerId) handlersRef.current.drop({ ...d, target: null });
    };
    const onKey = (e: KeyboardEvent) => {
      const d = holding();
      if (!d) return;
      if (e.code === 'Space' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handlersRef.current.flip(d);
      } else if (e.key === 'Escape') {
        handlersRef.current.drop({ ...d, target: null });
      }
    };
    const onWheel = (e: WheelEvent) => {
      const d = holding();
      if (!d) return;
      e.preventDefault();
      if (e.timeStamp - lastWheel > 280 && Math.abs(e.deltaY) > 2) {
        lastWheel = e.timeStamp;
        handlersRef.current.flip(d);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [px, py]);

  const onBookPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const press = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el: e.currentTarget };
    pressRef.current = press;
    if (e.pointerType !== 'mouse') {
      window.setTimeout(() => {
        // Still the same press: the finger neither lifted nor started dragging.
        if (pressRef.current !== press) return;
        pressRef.current = null;
        navigator.vibrate?.(10);
        handlersRef.current.turn(id);
      }, LONG_PRESS);
    }
  };

  const renderRow = (c: ContainerId, slots: Slot[]) => {
    const visible = drag ? slots.filter((s) => s.id !== drag.id) : slots;
    const items = visible.map((slot) => {
      const book = bookBySlug.get(slot.id)!;
      const others = slots.filter((s) => s.id !== slot.id);
      return (
        <ShelfBook
          key={slot.id}
          book={book}
          o={slot.o}
          c={c}
          scale={scale}
          named={!drag && lastOpened === slot.id}
          canTurn={c !== 'desk' && canFit(others, book, flipped(slot.o), c)}
          onPointerDown={onBookPointerDown}
          onOpen={open}
          onTurn={turn}
        />
      );
    });
    if (drag?.target?.c === c) {
      const book = bookBySlug.get(drag.id)!;
      const o = c === 'desk' ? 'cover' : drag.placeO;
      items.splice(
        drag.target.index,
        0,
        <motion.div
          key="__gap"
          layout="position"
          transition={LAYOUT_SPRING}
          className={`gap${drag.phase === 'landing' ? ' landing' : ''}`}
          style={{ width: outerWidth(book, o, c) * scale }}
        >
          <GhostBook book={book} o={o} c={c} scale={scale} />
        </motion.div>,
      );
    }
    return items;
  };

  const rowRef = (c: ContainerId) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(c, el);
    else rows.current.delete(c);
  };
  const zoneRef = (c: ContainerId) => (el: HTMLDivElement | null) => {
    if (el) zones.current.set(c, el);
    else zones.current.delete(c);
  };

  const draggedBook = drag ? bookBySlug.get(drag.id)! : null;
  const draggedGenre = draggedBook ? genreOf(draggedBook) : null;
  const deskEmpty = layout.desk.length === 0 && drag?.target?.c !== 'desk';
  // Two columns with an odd number of shelves: fill the last cell with an empty compartment.
  const filler = cols > 1 && layout.shelves.length % cols !== 0;

  return (
    <div className={`room${drag ? ' is-dragging' : ''}`}>
      <div className="bookcase" style={{ '--cols': cols, '--column-gap': `${COLUMN_GAP}px` } as CSSProperties}>
        <div className="bookcase-crown" />
        <div className="bookcase-body" ref={measureRef}>
          {layout.shelves.map((shelf, i) => {
            const state =
              drag?.blocked === i ? ' is-blocked' : drag?.phase === 'holding' && shelf.genre === draggedGenre ? ' is-home' : '';
            return (
              <section key={i} ref={zoneRef(i)} className={`compartment${state}`} aria-label={shelf.genre}>
                <div ref={rowRef(i)} className="row" style={{ width: SHELF_INNER * scale, height: SHELF_HEIGHT * scale }}>
                  {renderRow(i, shelf.slots)}
                </div>
                <div className="plank">
                  <span className="shelf-label">{shelf.genre}</span>
                </div>
              </section>
            );
          })}
          {filler && (
            <div className="compartment filler" aria-hidden="true">
              <div className="row" style={{ height: SHELF_HEIGHT * scale }} />
              <div className="plank" />
            </div>
          )}
        </div>
        <div className="bookcase-plinth" />
      </div>

      <div ref={zoneRef('desk')} className={`desk${drag?.blocked === 'desk' ? ' is-blocked' : ''}`}>
        <div
          ref={rowRef('desk')}
          className="row desk-row"
          style={{ width: SHELF_INNER * scale, height: SHELF_HEIGHT * DESK_SCALE * scale }}
        >
          {renderRow('desk', layout.desk)}
          {deskEmpty && <p className="desk-hint">Drop a book here to keep it out on the desk</p>}
        </div>
        <div className="desk-top" />
      </div>

      {drag && draggedBook && (
        <>
          <FloatingBook book={draggedBook} scale={scale} px={px} py={py} offX={offX} offY={offY} size={size} angle={angle} />
          {drag.phase === 'holding' && (
            <PlacementHint
              drag={drag}
              layout={layout}
              onFlip={() => dragRef.current && flip(dragRef.current)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ShelfBook(props: {
  book: Book;
  o: Orientation;
  c: ContainerId;
  scale: number;
  named: boolean;
  canTurn: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, id: string) => void;
  onOpen: (id: string) => void;
  onTurn: (id: string) => void;
}) {
  const { book, o, c, scale, named, canTurn, onPointerDown, onOpen, onTurn } = props;
  const k = containerScale(c) * scale;
  const width = slotWidth(book, o, c) * scale;
  const height = book.height * k;
  const angle = useTurningAngle(restingAngle(o, c));
  const turnTo = o === 'spine' ? 'cover out' : 'spine out';

  return (
    <motion.div
      layout="position"
      transition={LAYOUT_SPRING}
      className="slot"
      style={{ width: width + GAP * scale, height }}
      onPointerDown={(e) => onPointerDown(e, book.slug)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={book.author ? `${book.title} by ${book.author}` : book.title}
        title={book.author ? `${book.title} · ${book.author}` : book.title}
        className={`slot-book ${c === 'desk' ? 'on-desk' : o}`}
        style={{ width, height, viewTransitionName: named ? 'active-book' : undefined }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(book.slug);
          }
        }}
      >
        <Book3D book={book} scale={k} angle={angle} style={{ left: (width - coverWidth(book) * k) / 2 }} />
      </div>
      {c !== 'desk' && (
        <button
          type="button"
          className="turn-button"
          // Not `disabled`: a disabled button would let the press fall through and open the book.
          aria-disabled={!canTurn}
          aria-label={canTurn ? `Turn ${book.title} ${turnTo}` : `No room to turn ${book.title}`}
          title={canTurn ? `Turn it ${turnTo}` : 'No room on this shelf to turn it'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => canTurn && onTurn(book.slug)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
          </svg>
        </button>
      )}
    </motion.div>
  );
}

/** A resting angle that turns smoothly to its new value when it changes. */
function useTurningAngle(target: number) {
  const angle = useSpring(target, TURN_SPRING);
  useEffect(() => angle.set(target), [angle, target]);
  return angle;
}

/** A faint preview in the gap of how the book will stand once it's let go. */
function GhostBook({ book, o, c, scale }: { book: Book; o: Orientation; c: ContainerId; scale: number }) {
  const k = containerScale(c) * scale;
  const width = slotWidth(book, o, c) * scale;
  const angle = useTurningAngle(restingAngle(o, c));
  return (
    <div className="gap-ghost" style={{ width, height: book.height * k }}>
      <Book3D book={book} scale={k} angle={angle} style={{ left: (width - coverWidth(book) * k) / 2 }} />
    </div>
  );
}

function FloatingBook(props: {
  book: Book;
  scale: number;
  px: MotionValue<number>;
  py: MotionValue<number>;
  offX: MotionValue<number>;
  offY: MotionValue<number>;
  size: MotionValue<number>;
  angle: MotionValue<number>;
}) {
  const { book, scale, px, py, offX, offY, size, angle } = props;
  const x = useTransform(() => px.get() - offX.get());
  const y = useTransform(() => py.get() - offY.get());
  // Swing a little in the direction of travel, like a book held by its edge.
  const velocity = useVelocity(px);
  const swing = useSpring(useTransform(velocity, [-2400, 0, 2400], [-9, 0, 9], { clamp: true }), {
    stiffness: 260,
    damping: 22,
  });
  const w = coverWidth(book) * scale;
  const h = book.height * scale;

  return createPortal(
    <motion.div
      className="floating-book"
      style={{ x, y, scale: size, rotate: swing, width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }}
    >
      <Book3D book={book} scale={scale} angle={angle} lifted />
    </motion.div>,
    document.body,
  );
}

function PlacementHint({ drag, layout, onFlip }: { drag: Drag; layout: Layout; onFlip: () => void }) {
  const book = bookBySlug.get(drag.id)!;
  let message: string;
  if (drag.blocked === 'desk') message = 'The desk is full';
  else if (drag.blocked != null && !accepts(layout, drag.blocked, book)) message = `Belongs on the ${genreOf(book)} shelf`;
  else if (drag.blocked != null) message = 'Not enough room on this shelf';
  else if (drag.target?.c === 'desk') message = 'Leave it on the desk';
  else if (drag.target) message = drag.placeO === 'spine' ? 'Shelve it spine out' : 'Display it cover out';
  else message = 'Let go to put it back';

  return createPortal(
    <div className="placement-hint" role="status">
      <div className="hint-title">
        <strong>{book.title}</strong>
        <span>{message}</span>
      </div>
      <button
        type="button"
        className="hint-flip"
        title="Turn it (Space or scroll)"
        // Pointer-down so a second finger can flip on touch screens mid-drag.
        onPointerDown={(e) => {
          e.stopPropagation();
          onFlip();
        }}
      >
        <span className={drag.placeO === 'spine' ? 'on' : ''}>Spine</span>
        <span className={drag.placeO === 'cover' ? 'on' : ''}>Cover</span>
      </button>
    </div>,
    document.body,
  );
}

/** Scale books so a full shelf exactly fills a bookcase column; two columns on wide screens. */
function useCaseScale(ref: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState({ scale: 1, cols: 1 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number) => {
      const cols = width >= TWO_COLUMNS_FROM ? 2 : 1;
      const column = (width - COLUMN_GAP * (cols - 1)) / cols;
      setState({ cols, scale: Math.min(1.05, Math.max(0.34, column / SHELF_INNER)) });
    };
    update(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return state;
}
