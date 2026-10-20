import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { books } from '../lib/books';
import { initialLayout, loadLayout, saveLayout, type Layout } from '../lib/layout';

type ShelfState = {
  layout: Layout;
  setLayout: (layout: Layout) => void;
  resetLayout: () => void;
  /** The book whose page was opened last, so it can morph back into its slot. */
  lastOpened: string | null;
  setLastOpened: (slug: string | null) => void;
};

const ShelfContext = createContext<ShelfState | null>(null);

export function ShelfProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(() => loadLayout(books));
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  useEffect(() => saveLayout(layout), [layout]);

  const resetLayout = useCallback(() => setLayout(initialLayout(books)), []);

  const value = useMemo(
    () => ({ layout, setLayout, resetLayout, lastOpened, setLastOpened }),
    [layout, resetLayout, lastOpened],
  );

  return <ShelfContext.Provider value={value}>{children}</ShelfContext.Provider>;
}

export function useShelf() {
  const ctx = useContext(ShelfContext);
  if (!ctx) throw new Error('useShelf must be used inside <ShelfProvider>');
  return ctx;
}
