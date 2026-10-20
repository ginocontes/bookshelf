import { useEffect } from 'react';
import { Bookcase } from '../components/Bookcase';
import { books } from '../lib/books';
import { site } from '../config';
import { useShelf } from '../state/ShelfContext';

export function ShelfPage() {
  const { resetLayout } = useShelf();
  const pages = books.reduce((sum, b) => sum + (b.pages ?? 0), 0);
  const genres = new Set(books.map((b) => b.genre).filter(Boolean)).size;
  const reviewed = books.filter((b) => b.review).length;

  useEffect(() => {
    document.title = site.title;
  }, []);

  return (
    <main className="shelf-page">
      <header className="shelf-header">
        <h1>{site.title}</h1>
        <dl className="header-stats">
          <div>
            <dt>Books</dt>
            <dd>{books.length}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{pages.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Genres</dt>
            <dd>{genres}</dd>
          </div>
          <div>
            <dt>Reviewed</dt>
            <dd>{reviewed}</dd>
          </div>
        </dl>
      </header>

      <Bookcase />

      <footer className="shelf-footer">
        <button type="button" className="link-button" onClick={resetLayout}>
          Tidy up the shelves
        </button>
      </footer>
    </main>
  );
}
