# Bookshelf

A personal book blog that looks like a real bookshelf.

- **Click** a book to open its page: the cover and reading stats on the left, your review on the right.
- Every **genre has its own shelf**, labelled with a nameplate. A genre that outgrows its shelf gets a second one.
- **Drag** a book to pull it off the shelf and look at its cover. Drop it anywhere on its genre's shelf (they light up while you hold it), or leave it on the desk.
- A dropped book lines up with its neighbours: spine out among spines, cover out next to a display. A faint preview in the gap shows how it will land. To override it while holding the book, press **Space**, scroll, or tap the Spine/Cover toggle.
- To turn a book on the shelf without dragging it, hover over it and click **↻**. On touch screens, press and hold it.
- **Esc** while dragging puts the book back where it was. Your arrangement is saved in the browser.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

## Adding a book

Create `content/books/<slug>.md`. Only `title` is required. The frontmatter holds the details and the body is your review in Markdown. Leave the body empty and the page says the review is *yet to come*.

```markdown
---
title: The Hobbit
author: J.R.R. Tolkien
genre: Fantasy            # which shelf it lives on; change it and the book moves
# everything below is optional
isbn: "9780547928227"     # fetches the cover of your exact edition
published: 1937           # negative for BC, e.g. -375
pages: 300                # also sets how thick the spine is
format: Paperback
rating: 4.5               # 0–5, halves allowed
started: 2024-01-03
finished: 2024-01-14
tags: [classic, adventure]
display: false            # true stands it cover out when the shelves are set up
# cover: /my-cover.jpg    # any URL; or `cover: false` for a generated cover
# color: "#2f5d50"        # spine colour; otherwise sampled from the cover
---

Your review here…
```

`display` picks the books that face out. Each shelf turns its `display: true` books cover out (as many as fit) and everything else spine out. On a shelf where no book is marked, books *without* a `display` line are turned cover out automatically while the shelf has spare room. Changing which books are marked resets visitors' saved arrangements, so everyone sees your new selection.

Then run `npm run enrich`. It looks each new book up on Open Library, downloads a cover into `content/covers/`, and adds `pages`, `published` and `author` if they're missing. It never overwrites values you wrote. If it picks the wrong edition, add the `isbn` and run `npm run enrich -- --force <slug>`, or drop your own photo in `content/covers/<slug>.jpg`.

Settings like the site title are in `src/config.ts`.

## Deploying

`npm run build` produces a static site. Because book pages live at `/book/<slug>`, configure your host to serve `index.html` for unknown paths (Netlify: `/* /index.html 200` in `public/_redirects`; Vercel and Cloudflare Pages handle SPAs automatically).

## How it's built

Vite + React + TypeScript, [Motion](https://motion.dev) for the drag and 3D animation, React Router with View Transitions so the clicked book morphs into the cover on its page.

- `src/components/Book3D.tsx`: each book is a real CSS 3D box. Spine out = rotated 90°, cover out = 0°.
- `src/components/Bookcase.tsx`: drag and drop, the insertion gap, and the landing animation.
- `src/lib/layout.ts`: the shelf model (which book is where, what fits) and persistence.
- `src/lib/books.ts`: loads the Markdown files at build time.
- `scripts/enrich-books.mjs`: fills in covers and metadata from Open Library.
