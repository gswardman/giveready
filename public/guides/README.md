# Guides

Markdown source files for posts at `https://www.giveready.org/guides/{slug}`.

## How to publish a new guide

1. Create `public/guides/{slug}.md` with YAML frontmatter:

   ```
   ---
   title: How to Verify a Nonprofit Before Donating
   description: Five trust signals to check before sending money to any charity.
   published: 2026-05-08
   updated: 2026-05-08
   tags: [verification, due-diligence, donating]
   linked_causes: [music-education, mental-health]
   ---

   # Heading

   Body in markdown. Supported: headings (#, ##, ###), paragraphs, bold (**),
   italic (*), inline `code`, code blocks (```), links, unordered lists (-),
   ordered lists (1.), and blockquotes (>).
   ```

2. Add an entry to `GUIDES_MANIFEST` in `src/index.js`:

   ```js
   {
     slug: 'verify-a-nonprofit-before-donating',
     title: 'How to Verify a Nonprofit Before Donating',
     description: 'Five trust signals to check before sending money to any charity.',
     published: '2026-05-08',
     updated: '2026-05-08',
     tags: ['verification', 'due-diligence', 'donating'],
     linked_causes: ['music-education', 'mental-health'],
   },
   ```

3. Deploy via `./deploy.sh "publish guide: {slug}"`. The new entry appears at
   `/guides/{slug}` and in `/sitemap.xml` automatically.

## Markdown caveats

The Worker uses a small hand-rolled markdown parser. It supports the
essentials but NOT: tables, footnotes, images, nested lists, raw HTML, or
auto-linking bare URLs. If a guide needs more, swap `_renderMarkdown` in
`src/index.js` for `marked` or another full MD library.
