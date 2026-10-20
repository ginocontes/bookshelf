import { useEffect, useState, type PointerEvent } from 'react';
import { Link, useParams } from 'react-router';
import Markdown from 'react-markdown';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { Book3D } from '../components/Book3D';
import { Stars } from '../components/Stars';
import { type Book, bookBySlug, books, coverWidth, daysToRead, formatDate, formatYear } from '../lib/books';
import { site } from '../config';
import { useShelf } from '../state/ShelfContext';

export function BookPage() {
  const { slug = '' } = useParams();
  const book = bookBySlug.get(slug);
  const { setLastOpened } = useShelf();

  useEffect(() => {
    if (!book) return;
    setLastOpened(book.slug);
    document.title = `${book.title} · ${site.title}`;
  }, [book, setLastOpened]);

  if (!book) {
    return (
      <main className="book-page not-found">
        <h1>That book isn't on the shelf.</h1>
        <Link to="/" className="back-link">
          ← Back to the bookshelf
        </Link>
      </main>
    );
  }

  // Neighbours in library order (by genre, then author).
  const index = books.indexOf(book);
  const prev = books[index - 1];
  const next = books[index + 1];
  const hasMeta = book.rating != null || !!book.finished;

  return (
    <main className="book-page">
      <Link to="/" viewTransition className="back-link">
        ← Back to the bookshelf
      </Link>

      <div className="book-layout">
        <aside className="book-aside">
          <TiltingCover book={book} />
          <BookStats book={book} />
        </aside>

        <article className="review">
          <header className="review-header">
            <p className="eyebrow">
              {[book.genre, formatYear(book.published)].filter(Boolean).join(' · ')}
            </p>
            <h1>{book.title}</h1>
            {book.author && <p className="byline">by {book.author}</p>}
            {hasMeta && (
              <div className="review-meta">
                <Stars rating={book.rating} size={22} />
                {book.finished && <span>Finished {formatDate(book.finished)}</span>}
              </div>
            )}
          </header>

          {book.review ? (
            <div className="prose">
              <Markdown>{book.review}</Markdown>
            </div>
          ) : (
            <div className="review-pending">
              <span className="pending-mark" aria-hidden="true">
                ❦
              </span>
              <p className="pending-title">Review yet to come</p>
              <p>I haven't written about this one yet. Check back soon.</p>
            </div>
          )}

          {book.tags.length > 0 && (
            <ul className="tags">
              {book.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}

          <nav className="review-nav">
            {prev ? (
              <Link to={`/book/${prev.slug}`} className="review-nav-link">
                <span>← Previous</span>
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/book/${next.slug}`} className="review-nav-link next">
                <span>Next →</span>
                {next.title}
              </Link>
            )}
          </nav>
        </article>
      </div>
    </main>
  );
}

/** The book in 3D; it turns to follow the pointer so you can see the spine. */
function TiltingCover({ book }: { book: Book }) {
  const height = useCoverHeight();
  const scale = height / book.height;
  const target = useMotionValue(16);
  const angle = useSpring(target, { stiffness: 120, damping: 18 });

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - r.left) / r.width;
    target.set(-18 + t * 70);
  };

  return (
    <div className="tilt-stage" onPointerMove={onMove} onPointerLeave={() => target.set(16)}>
      <motion.div
        className="tilt-book"
        style={{ width: coverWidth(book) * scale, height, viewTransitionName: 'active-book' }}
        initial={{ y: 8, opacity: 0.9 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <Book3D book={book} scale={scale} angle={angle} lifted />
      </motion.div>
    </div>
  );
}

function useCoverHeight() {
  const compute = () => Math.round(Math.min(400, Math.max(240, window.innerWidth * 0.62)));
  const [h, setH] = useState(compute);
  useEffect(() => {
    const onResize = () => setH(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return h;
}

function BookStats({ book }: { book: Book }) {
  const days = daysToRead(book);
  const perDay = days && book.pages ? Math.round(book.pages / days) : undefined;
  const withPages = books.filter((b) => b.pages != null);
  const longerThan =
    book.pages != null && withPages.length > 1
      ? Math.round((withPages.filter((b) => b.pages! < book.pages!).length / (withPages.length - 1)) * 100)
      : undefined;
  const rated = [...books].filter((b) => b.rating != null).sort((a, b) => b.rating! - a.rating!);
  const rank = book.rating != null ? rated.findIndex((b) => b.rating === book.rating) + 1 : undefined;

  const tiles: [string, string | number | undefined][] = [
    ['Pages', book.pages],
    ['Days reading', days],
    ['Pages / day', perDay],
    ['Published', formatYear(book.published)],
    ['Started', formatDate(book.started)],
    ['Finished', formatDate(book.finished)],
    ['Format', book.format],
    ['Genre', book.genre],
  ];

  return (
    <section className="stats" aria-label="Reading statistics">
      <dl className="stat-grid">
        {tiles
          .filter(([, v]) => v != null && v !== '')
          .map(([label, value]) => (
            <div key={label} className={`stat${String(value).length > 16 ? ' wide' : ''}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      {longerThan != null && (
        <div className="stat-bar">
          <div className="stat-bar-label">
            <span>Length</span>
            <span>Longer than {longerThan}% of my books</span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.max(4, longerThan)}%` }} />
          </div>
        </div>
      )}

      {rank != null && rank > 0 && (
        <p className="stat-note">
          {rank === 1 ? 'Among my top-rated books' : `Rated in my top ${Math.ceil((rank / rated.length) * 100)}%`}
        </p>
      )}
    </section>
  );
}
