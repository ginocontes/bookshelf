import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from 'react-router';
import { ShelfProvider } from './state/ShelfContext';
import { ShelfPage } from './pages/ShelfPage';
import './styles.css';

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

// On GitHub Pages the site lives under /<repo>/, so routes are relative to the base URL.
const router = createBrowserRouter(
  [
    {
      element: <Root />,
      children: [
        { path: '/', element: <ShelfPage /> },
        {
          path: '/book/:slug',
          lazy: () => import('./pages/BookPage').then((m) => ({ Component: m.BookPage })),
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShelfProvider>
      <RouterProvider router={router} />
    </ShelfProvider>
  </StrictMode>,
);
