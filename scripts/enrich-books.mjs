// Fills in what a book file leaves out, using Open Library:
//   - downloads a cover to content/covers/<slug>.jpg (by ISBN if given, else by search)
//   - adds `pages`, `published` and `author` to the frontmatter when missing
// Values you've written yourself are never overwritten.
//
//   npm run enrich               # only books that are missing something
//   npm run enrich -- --force    # re-download every cover
//   npm run enrich -- the-hobbit # just these slugs

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const booksDir = path.join(root, 'content/books');
const coversDir = path.join(root, 'content/covers');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coverExts = ['jpg', 'jpeg', 'png', 'webp'];

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bookshelf-site (personal project)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) return false; // Open Library's 1×1 placeholder
  await writeFile(dest, buf);
  return true;
}

/** Best Open Library match for a title (and first author, if known). */
async function search(title, author) {
  const fields = 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i';
  const shortTitle = title.replace(/\(.*?\)/g, '').split(':')[0].trim();
  const firstAuthor = author?.split(/,|&| and /)[0].trim();
  const attempts = [];
  if (firstAuthor) attempts.push(`title=${encodeURIComponent(shortTitle)}&author=${encodeURIComponent(firstAuthor)}`);
  attempts.push(`q=${encodeURIComponent(`${shortTitle} ${firstAuthor ?? ''}`.trim())}`);

  for (const query of attempts) {
    const data = await getJson(`https://openlibrary.org/search.json?${query}&limit=5&fields=${fields}`);
    const docs = data.docs ?? [];
    if (docs.length) return docs.find((d) => d.cover_i) ?? docs[0];
    await sleep(300);
  }
  return null;
}

/** Append keys to the frontmatter block without disturbing what's there. */
function addFrontmatter(raw, entries) {
  const lines = Object.entries(entries).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
  return raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, (_, head, close) => `${head}\n${lines.join('\n')}${close}`);
}

await mkdir(coversDir, { recursive: true });
const files = (await readdir(booksDir)).filter((f) => f.endsWith('.md')).sort();
const summary = { covers: 0, updated: 0, missed: [] };

for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  if (only.length && !only.includes(slug)) continue;

  const filePath = path.join(booksDir, file);
  const raw = await readFile(filePath, 'utf8');
  const data = parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '') ?? {};
  const isbn = data.isbn ? String(data.isbn).replace(/-/g, '') : undefined;
  // `cover: false` opts out of downloading; a string is an explicit cover URL.
  const hasCover = data.cover === false || !!data.cover || coverExts.some((e) => existsSync(path.join(coversDir, `${slug}.${e}`)));
  const needsCover = data.cover !== false && (force || !hasCover);
  const needsMeta = !data.pages || !data.published || !data.author;
  if (!needsCover && !needsMeta) continue;

  const notes = [];
  try {
    const dest = path.join(coversDir, `${slug}.jpg`);
    let gotCover = false;
    if (needsCover && isbn) {
      gotCover = await download(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, dest);
      await sleep(400);
    }

    let match = null;
    if ((needsCover && !gotCover) || needsMeta) {
      match = await search(String(data.title ?? slug), data.author ? String(data.author) : undefined);
      await sleep(400);
    }

    if (match) {
      notes.push(`matched "${match.title}"${match.author_name ? ` by ${match.author_name[0]}` : ''}`);
      if (needsCover && !gotCover && match.cover_i) {
        gotCover = await download(`https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`, dest);
      }
      const add = {};
      if (!data.author && match.author_name?.length) add.author = match.author_name.slice(0, 3).join(', ');
      if (!data.published && match.first_publish_year) add.published = match.first_publish_year;
      if (!data.pages && match.number_of_pages_median) add.pages = match.number_of_pages_median;
      if (Object.keys(add).length) {
        await writeFile(filePath, addFrontmatter(raw, add));
        summary.updated++;
        notes.push(`added ${Object.keys(add).join(', ')}`);
      }
    } else if (needsMeta || !gotCover) {
      notes.push('no match on Open Library');
    }

    if (gotCover) {
      summary.covers++;
      notes.push('cover ✓');
    } else if (needsCover) {
      summary.missed.push(slug);
      notes.push('no cover (a generated one will be used)');
    }
  } catch (err) {
    summary.missed.push(slug);
    notes.push(`error: ${err.message}`);
  }
  console.log(`${slug}: ${notes.join(' · ')}`);
}

console.log(`\n${summary.covers} cover(s) downloaded, ${summary.updated} file(s) updated.`);
if (summary.missed.length) console.log(`Without a cover: ${summary.missed.join(', ')}`);
