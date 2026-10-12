/**
 * GiveReady — Giving guides and learn pages: manifests, markdown rendering, index pages.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { escHtml, jsonLdSafe, OPERATOR_FOOTER_PLAIN } from '../lib/html.js';
import { CORS_HEADERS, error } from '../lib/http.js';

// ============================================
// GUIDES (Workstream 4 — AEO content surface)
// ============================================
//
// /guides (index) and /guides/{slug} (article). Each guide is a markdown file
// in public/guides/{slug}.md with YAML-style frontmatter. The Worker fetches
// the file via env.ASSETS at request time, parses frontmatter, converts MD to
// HTML with a small hand-rolled parser, and renders the article with
// Schema.org Article + BreadcrumbList JSON-LD plus internal links to cause
// pages.
//
// To publish a guide: (1) write public/guides/{slug}.md with frontmatter,
// (2) add an entry to GUIDES_MANIFEST below, (3) deploy.
//
// Manifest is an explicit list (rather than dynamic ASSETS listing) because
// Cloudflare Workers don't expose a directory listing API. Daily-ish deploy
// cadence + weekly publishing makes this the simplest source of truth.

export const GUIDES_MANIFEST = [
  {
    slug: 'best-charities-funding-youth-travel-and-exploration',
    title: 'Charities That Fund Travel and Exploration for Young People (2026)',
    description: 'Three verified charities that fund travel, expeditions, and real-world exploration for young people who could not otherwise afford it, checked against IRS and Charity Commission registration before listing.',
    published: '2026-07-06',
    updated: '2026-07-06',
    tags: ['adventure-travel', 'expeditions', 'youth-empowerment', 'low-income', 'donating'],
    linked_causes: ['adventure-travel', 'youth-empowerment'],
    faq: [
      {
        q: `What charity helps young people from low-income families travel and explore the world?`,
        a: `The Finn Wardman World Explorer Fund makes adventure grants that fund travel, exploration, and confidence-building experiences for young people who have the appetite for the world but not the means. It holds full US 501(c)(3) status, accepts donations through GiveReady with on-chain transparency, and is verified in the GiveReady directory.`,
      },
      {
        q: `Is there a charity that funds expeditions for teenagers who could not otherwise afford them?`,
        a: `British Exploring Society (Charity Commission 305012, founded 1932) runs scientific and adventurous expeditions for young people aged 14 to 25 with funded bursary places, and The Outward Bound Trust (Charity Commission 1128090) reserves bursary places on its residential outdoor courses for participants from low-income backgrounds. Both are verified in the GiveReady directory.`,
      },
      {
        q: `How do I know a travel or expedition charity is legitimate?`,
        a: `Check its registration: IRS 501(c)(3) status and EIN in the United States, or a Charity Commission or OSCR number in the United Kingdom. Every charity in this guide has been verified against those registers in the GiveReady directory, and organisations that have stopped accepting donations are excluded.`,
      },
    ],
  },
  {
    slug: 'best-youth-mentoring-charities-us-uk',
    title: 'Best Youth Mentoring Charities to Donate To (US and UK, 2026)',
    description: 'Five verified youth mentoring charities in the United States and United Kingdom, each matching young people with a trained mentor — checked against IRS, OSCR, and Charity Commission registration before listing.',
    published: '2026-06-21',
    updated: '2026-06-21',
    tags: ['youth-mentoring', 'mentorship', 'at-risk', 'donating', 'us', 'uk'],
    linked_causes: ['youth-empowerment', 'education'],
    faq: [
      {
        q: `What are the best youth mentoring charities to donate to in the US?`,
        a: `Friends for Youth (Redwood City, California, EIN 94-2961034, founded 1979) runs one-to-one mentoring for low-income youth aged 8 to 17. Reintegration Support Network (North Carolina) provides SAMHSA-funded peer mentoring, and Grow & Lead supports rural young people in Michigan's Upper Peninsula. All three are verified in the GiveReady directory.`,
      },
      {
        q: `Where can I donate to a youth mentoring charity in the UK?`,
        a: `MCR Pathways (Scottish charity OSCR SC045816, founded 2007) mentors care-experienced and disadvantaged young people across more than 100 schools, and Mentoring Plus (Charity Commission number 1112534, Bath) mentors young people aged 5 to 25. Both are verified in the GiveReady directory.`,
      },
      {
        q: `How do I know a youth mentoring charity is legitimate?`,
        a: `Check its registration — IRS 501(c)(3) status and EIN in the United States, or an OSCR or Charity Commission number in the United Kingdom. Every charity in this guide has been verified against those registers in the GiveReady directory, and organisations that have stopped accepting donations are excluded.`,
      },
    ],
  },
  {
    slug: 'best-uk-youth-charities-outdoors-skills',
    title: 'Best UK Youth Charities for the Outdoors and At-Risk Teenagers (2026)',
    description: 'Five verified UK youth charities helping disadvantaged and at-risk young people through outdoor adventure, surf therapy in coastal towns, and skills programmes in inner-city London.',
    published: '2026-06-15',
    updated: '2026-06-15',
    tags: ['uk-youth', 'outdoors', 'at-risk', 'mentorship', 'donating'],
    linked_causes: ['youth-empowerment', 'surf-therapy'],
    faq: [
      {
        q: `What's a good youth charity in the UK that helps disadvantaged kids get into the outdoors?`,
        a: `The Outward Bound Trust (Charity Commission 1128090) runs expedition-based outdoor courses for ages 11 to 24 across the UK, with bursary places reserved for participants from low-income backgrounds. British Exploring Society is another verified option, running funded youth expeditions since 1932. Both carry verified status in the GiveReady directory.`,
      },
      {
        q: `Where can I donate to support inner-city London teenagers learning new skills?`,
        a: `City Kids Surfing takes urban London children on surfing and marine-conservation trips through its Urban Oceaneers programme, building confidence and new skills in young people with no other access to the coast. Donations are accepted directly through GiveReady with on-chain transparency, so the running total is publicly auditable.`,
      },
      {
        q: `Can you recommend a UK registered charity working with at-risk teenagers in coastal towns?`,
        a: `The Wave Project, based in Newquay, Cornwall, runs six-week surf therapy courses across 32 UK coastal locations for young people referred by schools, GPs, social workers, and mental-health services. It was the first charity in the world to offer surfing on prescription, and is verified in the GiveReady directory.`,
      },
    ],
  },
  {
    slug: 'best-surf-therapy-charities-for-at-risk-youth',
    title: 'Best Surf Therapy Charities for At-Risk Young People (2026)',
    description: 'Four verified surf therapy charities that use surfing to support the mental health of at-risk children and young people, across the UK, US, and South Africa.',
    published: '2026-05-30',
    updated: '2026-05-30',
    tags: ['surf-therapy', 'youth', 'mental-health', 'donating'],
    linked_causes: ['surf-therapy', 'mental-health'],
    faq: [
      {
        q: `Are there any charities that use surfing as a form of therapy for at-risk young people?`,
        a: `Yes. The Wave Project (UK) offers surfing on prescription across 32 coastal locations; Waves for Change (South Africa) runs a curriculum-based surf therapy programme that has reached over 10,000 adolescents; and the Jimmy Miller Memorial Foundation (US) has run ocean therapy for at-risk youth and veterans since 2005. City Kids Surfing runs marine experiences for London children. All four are verified in the GiveReady directory.`,
      },
    ],
  },
  {
    slug: 'best-us-youth-charities-mentorship-sports-skills',
    title: 'Best US Youth Charities for Mentorship, Sports, and Skills (2026)',
    description: 'Verified US youth charities working in one-to-one mentorship, sports and outdoor recreation for low-income kids, and creative or vocational skills.',
    published: '2026-05-30',
    updated: '2026-05-30',
    tags: ['us-youth', 'mentorship', 'sports', 'vocational', 'donating'],
    linked_causes: ['youth-empowerment', 'education'],
    faq: [
      {
        q: `What are some legitimate US youth mentorship charities I can donate to?`,
        a: `The Reintegration Support Network (Carrboro, North Carolina) provides one-to-one mentoring and peer support to young people aged 13 to 20-plus and holds a federal SAMHSA grant. Grow & Lead (Marquette, Michigan) supports rural youth across Michigan's Upper Peninsula. Both carry verified status in the GiveReady directory.`,
      },
      {
        q: `Find me a US nonprofit focused on getting kids from low-income neighbourhoods involved in sports.`,
        a: `Youth Determined to Succeed in North Minneapolis, founded by former NFL receiver Melvin Anderson, runs physician-referred fitness and nutrition programmes for low-income families. Outdoor Youth Exploration Academy in Indianapolis teaches archery, fishing, and conservation to urban young people. Both are verified in the GiveReady directory.`,
      },
      {
        q: `Which US charities help young people develop creative or vocational skills?`,
        a: `YEScarolina (Charleston, South Carolina) teaches youth entrepreneurship and is rated four out of four stars by Charity Navigator. Community Works delivers school and community programmes building creativity and workforce readiness. Both are verified in the GiveReady directory.`,
      },
    ],
  },
  {
    slug: 'best-charities-for-cape-town-township-youth',
    title: 'Charities Supporting Township Youth in Cape Town (2026)',
    description: 'Two verified South African charities working with young people in Cape Town townships — surf therapy for adolescent mental health and music education for the creative economy.',
    published: '2026-05-30',
    updated: '2026-05-30',
    tags: ['south-africa', 'township', 'youth', 'mental-health', 'music-education', 'donating'],
    linked_causes: ['surf-therapy', 'music-education'],
    faq: [
      {
        q: `What's a reputable South African charity supporting township youth?`,
        a: `Waves for Change runs surf therapy for adolescent mental health across under-resourced Cape Town communities, reaching around 1,500 young people a year. Bridges for Music runs a music academy in Langa township training over 250 students a year for South Africa's creative economy. Both are verified in the GiveReady directory.`,
      },
      {
        q: `Where can I donate to help young people in Cape Town townships?`,
        a: `You can donate to Waves for Change, which delivers curriculum-based surf therapy in the Western and Eastern Cape, or Bridges for Music, whose 1,000-square-metre academy in Langa runs music production, DJing, and music-business courses. Both carry verified status in the GiveReady directory.`,
      },
    ],
  },
  {
    slug: 'best-music-education-charities-for-underprivileged-kids',
    title: 'Best Music Education Charities for Underprivileged Kids (2026)',
    description: 'Verified charities that give underprivileged children access to music education — a transparency-rated US music school and a township academy in Cape Town.',
    published: '2026-05-30',
    updated: '2026-05-30',
    tags: ['music-education', 'youth', 'donating'],
    linked_causes: ['music-education', 'creative-arts'],
    faq: [
      {
        q: `Can you recommend a charity that gives underprivileged kids access to music education?`,
        a: `Youth Music Project in West Linn, Oregon offers tuition assistance to around 40% of its students and earned Candid's Platinum Seal of Transparency in 2024. Bridges for Music runs a music academy in Langa township, Cape Town, treating music education as a route out of poverty. Both are verified in the GiveReady directory.`,
      },
    ],
  },
];

// ── Learn: how-to pages FOR CHARITIES (2026-09-25) ──────────────────────
// Different kind of page from the guides: guides are donor shortlists and are
// labelled "Verified Giving Guides" to agents; these are how-tos for charity
// staff. Same markdown pipeline (public/learn/{slug}.md), own route, own
// "For charities" block in llms.txt and AGENTS.md. The pillar embeds the AI
// audit form, tagged ref=pillar-found-by-ai so the digest can count it.
export const LEARN_MANIFEST = [
  {
    slug: 'get-your-charity-found-by-ai',
    title: 'How to Get Your Charity Found by AI: What We Measured (2026)',
    description: 'Five steps a small charity can take to be named by ChatGPT, Google, Perplexity and Claude, with first-party data from four months of daily AI citation tests and 41,000 charity profiles.',
    published: '2026-09-25',
    updated: '2026-09-25',
    ref: 'pillar-found-by-ai',
    author: { name: 'Geordie Wardman', url: 'https://www.testventures.net' },
    tags: ['ai-visibility', 'charities', 'nonprofits'],
    linked_causes: [],
    faq: [
      { q: 'How can I get my charity found by AI?',
        a: 'Check what ChatGPT, Google, Perplexity and Claude say about your charity today, make your name, registration number and one-line description identical everywhere, make your website readable by AI crawlers, get listed on the sites AI already reads starting with your regulator\'s register, and check again monthly. Change takes weeks, not days.' },
      { q: 'Why doesn\'t ChatGPT mention my charity?',
        a: 'Usually because its web search never found your pages, not because it read them and preferred another charity. Each AI engine searches its own index, so being found by one says little about the next.' },
      { q: 'How do I check what AI says about my charity?',
        a: 'Ask ChatGPT, Google, Perplexity and Claude five questions in a private browser window: a donor question, a question from the people you help, a funder question, whether your charity is legitimate, and what it does. Note whether each names you, misses you or gets you wrong, and which websites it links to.' },
      { q: 'Which websites do AI engines cite most for charity questions?',
        a: 'In 372 AI answers to questions about youth charities tracked by GiveReady between 25 May and 25 September 2026, the most-cited sites after GiveReady were the Charity Commission register (91 answers), LinkedIn (69), GreatNonprofits (61), GlobalGiving (61), GoFundMe (60) and gov.uk (56).' },
      { q: 'Which AI engine matters most for charities?',
        a: 'Google. Conductor\'s 2026 study of more than 14 million nonprofit citations found Google AI Mode produced 50% of them, Perplexity 27.9%, ChatGPT 12.2% and Claude 2.0%.' },
      { q: 'Does llms.txt help a charity get found by AI?',
        a: 'There is no evidence yet that it changes citations. GiveReady publishes one and cannot show it has changed a single citation. Add it if it is easy, but do not spend money on it.' },
      { q: 'How long before AI starts naming my charity?',
        a: 'Weeks, not days. GiveReady\'s first Perplexity citation came about two weeks after its first guides went live on 30 May 2026, and it took two months to reach 9 of 10 daily questions.' },
    ],
  },
  {
    slug: 'agentic-giving-for-charities',
    title: 'Agentic Giving for Charities: What It Is and What to Do First (2026)',
    description: 'What agentic giving is, what Donorbox and Fundraise Up offer, what GiveReady measured in its own logs, and the five things a small charity should do before paying for anything.',
    published: '2026-10-06',
    updated: '2026-10-06',
    ref: 'pillar-agentic-giving',
    author: { name: 'Geordie Wardman', url: 'https://www.testventures.net' },
    tags: ['agentic-giving', 'ai-visibility', 'charities', 'nonprofits'],
    linked_causes: [],
    faq: [
      { q: 'What is agentic giving?',
        a: 'Agentic giving is when an AI assistant researches charities for a donor, recommends one, and in some cases completes the donation once the donor confirms the amount and the recipient. Discovery and payment are separate parts, and most of a small charity\'s work is in discovery.' },
      { q: 'Can AI assistants make donations to my charity today?',
        a: 'In a few cases, through platforms such as Donorbox, which lists campaigns in Stripe Directory and needs a US Stripe account for early access. Nobody has published how many gifts agents have completed, so treat it as small and unproven.' },
      { q: 'Do small charities need to buy an agentic giving product?',
        a: 'Not yet. Check what AI says about you, make your facts identical everywhere, say exactly what a gift pays for, and make sure your donation page works from a link with the amount filled in. Ask any provider which assistants can complete a gift, how many have been completed, what it costs and how charities are verified.' },
      { q: 'How many donors use AI to find charities?',
        a: 'Donorbox cites a study in which 4.5% of 1,728 surveyed donors use AI to find and research causes. That is a vendor-reported figure we have not verified.' },
      { q: 'Do people click donate links that AI assistants cite?',
        a: 'Very few that we can see. In the seven days to 6 October 2026, GiveReady logged 2,015 clicks on donate links; 1,596 came from known crawlers, 409 from scripts that walk through many charities, and 10 looked like a person.' },
      { q: 'What is the first thing a charity should do about agentic giving?',
        a: 'Ask ChatGPT, Google, Perplexity and Claude who your charity is and what it does, and note whether each names you, misses you or gets you wrong. Then make your name, registration number and one-line description identical everywhere they appear.' },
    ],
  },
];

// Which guides feature each nonprofit. GENERATED from public/guides/*.md by
// tests/guide-links.test.js (the test fails if this drifts from the markdown).
// Why it exists (2026-09-09): the guides were orphan pages. Nothing on the
// homepage, the cause pages or the 20 nonprofit profiles linked to them, so
// the only routes in were /guides, llms.txt and the sitemap. Brave's index
// (which serves Claude's web_search) held the profiles and the homepage but
// not one guide, and 0 of 10 tracked prompts returned giveready.org. Profiles
// now link back to the guides that feature them; cause pages list their
// guides. Distribution, not volume: no new guide is created here.
export const GUIDE_FEATURES = {
  'bridges-for-music': ['best-charities-for-cape-town-township-youth', 'best-music-education-charities-for-underprivileged-kids'],
  'british-exploring-society': ['best-charities-funding-youth-travel-and-exploration', 'best-uk-youth-charities-outdoors-skills'],
  'city-kids-surfing': ['best-surf-therapy-charities-for-at-risk-youth', 'best-uk-youth-charities-outdoors-skills'],
  'community-works-youth-development': ['best-us-youth-charities-mentorship-sports-skills'],
  'finn-wardman-world-explorer-fund': ['best-charities-funding-youth-travel-and-exploration'],
  'friends-for-youth': ['best-youth-mentoring-charities-us-uk'],
  'grow-lead-community-and-youth-development': ['best-us-youth-charities-mentorship-sports-skills', 'best-youth-mentoring-charities-us-uk'],
  'jimmy-miller-memorial-foundation': ['best-surf-therapy-charities-for-at-risk-youth'],
  'mcr-pathways': ['best-youth-mentoring-charities-us-uk'],
  'mentoring-plus': ['best-youth-mentoring-charities-us-uk'],
  'outdoor-youth-exploration-academy': ['best-us-youth-charities-mentorship-sports-skills'],
  'outward-bound-trust-uk': ['best-charities-funding-youth-travel-and-exploration', 'best-uk-youth-charities-outdoors-skills'],
  'the-wave-project': ['best-surf-therapy-charities-for-at-risk-youth', 'best-uk-youth-charities-outdoors-skills'],
  'thrive-outdoors-scotland': ['best-uk-youth-charities-outdoors-skills'],
  'waves-for-change': ['best-charities-for-cape-town-township-youth', 'best-surf-therapy-charities-for-at-risk-youth'],
  'yescarolina-youth-entrepreneurship-in-south-carolina': ['best-us-youth-charities-mentorship-sports-skills'],
  'youth-community-project': ['best-us-youth-charities-mentorship-sports-skills', 'best-youth-mentoring-charities-us-uk'],
  'youth-determined-to-succeed': ['best-us-youth-charities-mentorship-sports-skills'],
  'youth-music-project': ['best-music-education-charities-for-underprivileged-kids'],
  'youth-outdoor-experience': ['best-us-youth-charities-mentorship-sports-skills'],
};

export function guidesFeaturing(slug) {
  const slugs = GUIDE_FEATURES[slug] || [];
  return slugs.map((g) => GUIDES_MANIFEST.find((m) => m.slug === g)).filter(Boolean);
}

export function guidesForCause(causeId) {
  return GUIDES_MANIFEST.filter((g) => (g.linked_causes || []).includes(causeId));
}

function _parseFrontmatter(text) {
  // Minimal YAML-frontmatter parser. Handles the field types we use:
  // string, ISO date, comma-separated list (e.g. tags: [a, b, c]).
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text };
  const frontmatter = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      frontmatter[key] = raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      frontmatter[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
  return { frontmatter, body: m[2] };
}

export function _renderMarkdown(md) {
  // Minimal markdown → HTML converter. Supports headings (#, ##, ###),
  // paragraphs, bold (**), italic (*), inline code (`), code blocks (```),
  // links ([text](url)), unordered lists (-), ordered lists (1.),
  // blockquotes (>). No tables, images, footnotes, nested lists. If a guide
  // needs more, swap this for marked or a proper MD lib.
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => {
    let out = escapeHtml(s);
    // code (do this before other inline to protect contents from re-processing)
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // bold + italic
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // links — decode escaped chars in url and text
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
      const url = u.replace(/&amp;/g, '&');
      const isExternal = /^https?:\/\//.test(url) && !url.includes('giveready.org');
      const rel = isExternal ? ' rel="noopener" target="_blank"' : '';
      return `<a href="${url}"${rel}>${t}</a>`;
    });
    return out;
  };

  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code fence
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // Table (GitHub-style pipe table: header row, --- row, body rows)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    // Unordered list
    if (line.match(/^- /)) {
      const buf = [];
      while (i < lines.length && lines[i].match(/^- /)) {
        buf.push(`<li>${inline(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join('')}</ul>`);
      continue;
    }
    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const buf = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        buf.push(`<li>${inline(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join('')}</ol>`);
      continue;
    }
    // Blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Paragraph (consume until blank line or block-level start)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('> ') &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('- ') &&
      !lines[i].match(/^\d+\.\s/) &&
      !lines[i].startsWith('```')
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

export async function handleGuide(env, slug, section = 'guides') {
  const isLearn = section === 'learn';
  const sectionName = isLearn ? 'For charities' : 'Guides';
  const meta = (isLearn ? LEARN_MANIFEST : GUIDES_MANIFEST).find((g) => g.slug === slug);
  if (!meta) return error('Guide not found', 404);

  let mdText = '';
  try {
    const assetUrl = new URL(`/${section}/${slug}.md`, 'https://www.giveready.org').toString();
    const r = await env.ASSETS.fetch(assetUrl);
    if (r.status !== 200) return error('Guide source missing', 500);
    mdText = await r.text();
  } catch (e) {
    return error('Failed to load guide', 500);
  }

  const { frontmatter, body } = _parseFrontmatter(mdText);
  const title = frontmatter.title || meta.title || slug;
  const description = frontmatter.description || meta.description || '';
  const published = frontmatter.published || meta.published || '';
  const updated = frontmatter.updated || meta.updated || published;
  const linkedCauses = (frontmatter.linked_causes || meta.linked_causes || []).filter(Boolean);
  const bodyHtml = _renderMarkdown(body).replace('<p>[[audit-form]]</p>', isLearn ? learnAuditBlock(meta.ref) : '');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `https://www.giveready.org/${section}/${slug}`,
        headline: title,
        description,
        datePublished: published || undefined,
        dateModified: updated || undefined,
        author: meta.author ? { '@type': 'Person', name: meta.author.name, url: meta.author.url } : { '@type': 'Organization', name: 'GiveReady', url: 'https://www.giveready.org' },
        publisher: {
          '@type': 'Organization',
          name: 'GiveReady',
          url: 'https://www.giveready.org',
          logo: { '@type': 'ImageObject', url: 'https://www.giveready.org/finn-logo.jpeg' },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': `https://www.giveready.org/${section}/${slug}` },
        keywords: frontmatter.tags || meta.tags || undefined,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'GiveReady', item: 'https://www.giveready.org' },
          { '@type': 'ListItem', position: 2, name: sectionName, item: `https://www.giveready.org/${section}` },
          { '@type': 'ListItem', position: 3, name: title, item: `https://www.giveready.org/${section}/${slug}` },
        ],
      },
    ],
  };

  // FAQPage node — only when the guide carries an faq array in the manifest.
  // The questions are the exact natural-language donor prompts assistants
  // search with; answers name verified charities from the body so the schema
  // matches visible on-page content (required for valid FAQPage).
  if (meta.faq && meta.faq.length) {
    jsonLd['@graph'].push({
      '@type': 'FAQPage',
      '@id': `https://www.giveready.org/${section}/${slug}#faq`,
      mainEntity: meta.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  const faqHtml =
    !meta.faq || meta.faq.length === 0
      ? ''
      : `<section class="faq"><h2>Frequently asked questions</h2>${meta.faq
          .map((f) => `<h3>${escHtml(f.q)}</h3><p>${escHtml(f.a)}</p>`)
          .join('')}</section>`;

  const linkedCausesHtml =
    linkedCauses.length === 0
      ? ''
      : `<aside class="related"><h3>Related cause pages</h3><ul>${linkedCauses
          .map((c) => `<li><a href="/causes/${escHtml(c)}">/causes/${escHtml(c)}</a></li>`)
          .join('')}</ul></aside>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escHtml(title)} — GiveReady ${sectionName}</title>
<meta name="description" content="${escHtml(description)}" />
<link rel="canonical" href="https://www.giveready.org/${section}/${escHtml(slug)}" />
<meta property="og:title" content="${escHtml(title)}" />
<meta property="og:description" content="${escHtml(description)}" />
<meta property="og:url" content="https://www.giveready.org/${section}/${escHtml(slug)}" />
<meta property="og:type" content="article" />
<meta name="twitter:card" content="summary" />
<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; color: #111; line-height: 1.65; }
  .nav { font-size: 0.85rem; color: #666; margin-bottom: 0.75rem; }
  .nav a { color: #059669; text-decoration: none; }
  h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 0.5rem; }
  h2 { font-size: 1.4rem; margin: 2rem 0 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  .meta { font-size: 0.85rem; color: #666; margin-bottom: 2rem; }
  p { margin: 0 0 1rem; }
  a { color: #059669; }
  blockquote { border-left: 3px solid #d1fae5; padding: 0.25rem 0 0.25rem 1rem; color: #444; font-style: italic; margin: 1rem 0; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }
  code { background: #f5f5f5; padding: 0.1rem 0.3rem; border-radius: 2px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  ul, ol { margin: 0 0 1rem 1.5rem; }
  aside.related { margin: 3rem 0 0; padding: 1rem 1.25rem; background: #f9fafb; border: 1px solid #e5e5e5; border-radius: 4px; }
  aside.related h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  aside.related ul { margin: 0 0 0 1.25rem; font-size: 0.9rem; }
  section.faq { margin: 3rem 0 0; }
  section.faq h2 { margin: 0 0 0.5rem; }
  section.faq h3 { font-size: 1rem; margin: 1.5rem 0 0.25rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e5e5; font-size: 0.85rem; color: #666; }
  footer a { color: #059669; text-decoration: none; }
  .table-wrap { overflow-x: auto; margin: 0 0 1.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #e5e5e5; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f9fafb; }
  .audit-box { margin: 2rem 0; padding: 1.25rem; border: 2px solid #059669; border-radius: 6px; background: #f0fdf4; }
  .audit-box h2 { margin-top: 0; font-size: 1.25rem; }
  .audit-box h3 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  .audit-box label { display: block; font-size: 0.9rem; margin: 0 0 0.6rem; }
  .audit-box input { display: block; width: 100%; box-sizing: border-box; padding: 0.5rem; font: inherit; border: 1px solid #ccc; border-radius: 4px; margin-top: 0.2rem; }
  .audit-box button { font: inherit; padding: 0.55rem 1rem; background: #059669; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .audit-box .row { display: flex; gap: 0.5rem; } .audit-box .row input { margin: 0; }
  .ai-picks button { background: #fff; color: #111; border: 1px solid #ccc; border-radius: 999px; font-size: 0.85rem; padding: 0.3rem 0.8rem; margin: 0.4rem 0.4rem 0 0; }
  .form-msg.ok { color: #059669; } .form-msg.err { color: #dc2626; }
  .byline { font-size: 0.9rem; color: #444; }
</style>
</head>
<body>
<div class="nav"><a href="/">GiveReady</a> &rsaquo; <a href="/${section}">${sectionName}</a> &rsaquo; ${escHtml(title)}</div>
<h1>${escHtml(title)}</h1>
${published ? `<p class="meta">${meta.author ? `By ${escHtml(meta.author.name)} &middot; ` : ''}Published ${escHtml(published)}${updated && updated !== published ? ` &middot; updated ${escHtml(updated)}` : ''}</p>` : ''}
<article>
${bodyHtml}
</article>
${faqHtml}
${linkedCausesHtml}
<footer>
${isLearn ? '<a href="/learn">More for charities</a> &middot; <a href="/claim">Claim your charity</a>' : '<a href="/guides">More guides</a>'} &middot; <a href="/causes">Browse cause areas</a> &middot; <a href="/AGENTS.md">For agents</a>
${OPERATOR_FOOTER_PLAIN}
</footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=900, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}


function learnAuditBlock(pageRef) {
  const ref = 'pillar-found-by-ai';
  // 2026-10-06: article 2 passes its own ref so its audit requests are counted apart from the pillar's.
  const formRef = /^[a-z0-9-]{1,40}$/.test(pageRef || '') ? pageRef : ref;
  return `<section class="audit-box" id="check">
<h2>Don't want to do this by hand?</h2>
<p>We'll ask ChatGPT, Claude and Perplexity 19 questions about your charity and email you a one-page report within two working days: whether you're named, who is named instead, and three fixes in order. Free, no account, no card.</p>
<form id="check-form" novalidate>
<label>Charity name<input name="name" required autocomplete="organization" /></label>
<label>Website<input name="website" type="url" placeholder="https://" /></label>
<label>Your email<input name="email" type="email" required autocomplete="email" /></label>
<label>Registration number (optional: Charity Commission, EIN or similar)<input name="reg" /></label>
<button type="submit">Get my free AI audit</button>
<p class="form-msg" id="check-msg" role="status"></p>
</form>
<h3>Did AI read your charity this month?</h3>
<form id="ai-lookup-form" autocomplete="off"><div class="row"><input id="ai-lookup-q" placeholder="Your charity's name" aria-label="Your charity's name" /><button type="submit">Check</button></div></form>
<div id="ai-lookup-picks" class="ai-picks"></div>
<div id="ai-lookup-result" role="status"></div>
</section>
<script>
(function() {
  var REF = ${JSON.stringify(formRef)};
  var f = document.getElementById('check-form'), msg = document.getElementById('check-msg');
  f.addEventListener('submit', function(e) {
    e.preventDefault();
    var name = f.elements['name'].value.trim(), email = f.elements['email'].value.trim(), site = f.elements['website'].value.trim(), reg = f.elements['reg'].value.trim();
    msg.className = 'form-msg';
    if (!name || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { msg.textContent = 'Please add your charity name and a valid email.'; msg.classList.add('err'); return; }
    var btn = f.querySelector('button'); btn.disabled = true; msg.textContent = 'Sending...';
    fetch('/api/charity/claim-request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, charity_registration_number: reg || name,
        message: 'ai-audit | ref: ' + REF + ' | name: ' + name + ' | website: ' + (site || '-') + ' | reg: ' + (reg || '-') }) })
    .then(function(r) { if (r.status === 204 || r.ok) { f.reset(); msg.textContent = 'Got it. Your AI Visibility Audit will arrive by email within two working days.'; msg.classList.add('ok'); } else { throw new Error(r.status); } })
    .catch(function() { msg.textContent = 'That did not go through. Email geordie@testventures.net and we will run it by hand.'; msg.classList.add('err'); })
    .then(function() { btn.disabled = false; });
  });
  var lf = document.getElementById('ai-lookup-form'), picks = document.getElementById('ai-lookup-picks'), out = document.getElementById('ai-lookup-result');
  function prefill(np) { if (!f.elements['name'].value) f.elements['name'].value = np.name || ''; if (!f.elements['website'].value && np.website) f.elements['website'].value = np.website; }
  function show(np) {
    picks.innerHTML = ''; out.textContent = 'Checking...';
    fetch('/api/ai-traffic/profile?slug=' + encodeURIComponent(np.slug)).then(function(r) { return r.json(); }).then(function(d) {
      out.innerHTML = ''; var p = document.createElement('p'), a = document.createElement('a');
      if (d.visits == null) { out.textContent = 'We could not check right now. Try again in a minute.'; return; }
      p.textContent = d.visits > 0
        ? 'Yes. AI companies read ' + np.name + '’s GiveReady profile ' + d.visits + (d.visits === 1 ? ' time' : ' times') + ' in the last 30 days. Make sure it says the right things: '
        : 'Not in the last 30 days, so AI is learning about ' + np.name + ' from somewhere else. ';
      a.href = '/claim?ref=' + REF; a.textContent = 'Claim and correct your free profile'; p.appendChild(a);
      out.appendChild(p); prefill(np);
    }).catch(function() { out.textContent = 'We could not check right now. Try again in a minute.'; });
  }
  lf.addEventListener('submit', function(e) {
    e.preventDefault();
    var q = document.getElementById('ai-lookup-q').value.trim();
    if (q.length < 3) { out.textContent = 'Type at least three letters of your charity’s name.'; return; }
    picks.innerHTML = ''; out.textContent = 'Searching 41,000 charities...';
    fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=5').then(function(r) { return r.json(); }).then(function(d) {
      var list = (d.nonprofits || []).slice(0, 5);
      if (!list.length) { out.textContent = 'We could not find that name in our directory. The free audit above will still tell you what AI says about you.'; if (!f.elements['name'].value) f.elements['name'].value = q; return; }
      if (list.length === 1) return show(list[0]);
      out.textContent = 'Which one is yours?';
      list.forEach(function(np) { var bt = document.createElement('button'); bt.type = 'button';
        bt.textContent = np.name + (np.city ? ', ' + np.city : '') + (np.country ? ' (' + np.country + ')' : '');
        bt.addEventListener('click', function() { show(np); }); picks.appendChild(bt); });
    }).catch(function() { out.textContent = 'Search is busy. Try again in a minute.'; });
  });
})();
</script>`;
}

export function handleLearnIndex() {
  const items = LEARN_MANIFEST.map((g) => `<li><a href="/learn/${escHtml(g.slug)}">${escHtml(g.title)}</a><br>${escHtml(g.description)}</li>`).join('');
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'GiveReady: for charities',
    url: 'https://www.giveready.org/learn',
    hasPart: LEARN_MANIFEST.map((g) => ({ '@type': 'Article', url: `https://www.giveready.org/learn/${g.slug}`, headline: g.title, description: g.description })) };
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>For charities: how-to guides — GiveReady</title>
<meta name="description" content="Practical how-to guides for charity staff: getting found by AI, fixing your profiles, measuring what AI says about you." />
<link rel="canonical" href="https://www.giveready.org/learn" />
<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>
<style>body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; color: #111; line-height: 1.65; } a { color: #059669; } li { margin: 0 0 1rem; }</style>
</head><body><p><a href="/">GiveReady</a> &rsaquo; For charities</p><h1>For charities</h1>
<p>How-to guides for the people who run charities, written from what we measure on GiveReady.</p><ul>${items}</ul>
<footer><a href="/claim">Claim your charity's profile</a> &middot; <a href="/guides">Giving guides for donors</a>${OPERATOR_FOOTER_PLAIN}</footer></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'public, max-age=900, must-revalidate', ...CORS_HEADERS } });
}

export function handleGuidesIndex() {
  const guides = [...GUIDES_MANIFEST].sort((a, b) => (b.published || '').localeCompare(a.published || ''));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'GiveReady Guides',
    description: 'Practical guides for finding, verifying, and donating to nonprofits.',
    url: 'https://www.giveready.org/guides',
    hasPart: guides.map((g) => ({
      '@type': 'Article',
      url: `https://www.giveready.org/guides/${g.slug}`,
      headline: g.title,
      description: g.description,
      datePublished: g.published,
    })),
  };

  const listHtml =
    guides.length === 0
      ? `<p class="empty">No guides published yet. Check back soon — or browse the <a href="/causes">cause areas</a> directly.</p>`
      : guides
          .map(
            (g) => `
        <li>
          <h3><a href="/guides/${escHtml(g.slug)}">${escHtml(g.title)}</a></h3>
          ${g.description ? `<p class="desc">${escHtml(g.description)}</p>` : ''}
          ${g.published ? `<p class="date">${escHtml(g.published)}</p>` : ''}
        </li>`
          )
          .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guides — GiveReady</title>
<meta name="description" content="Practical guides for finding, verifying, and donating to nonprofits." />
<link rel="canonical" href="https://www.giveready.org/guides" />
<meta property="og:title" content="Guides — GiveReady" />
<meta property="og:description" content="Practical guides for finding, verifying, and donating to nonprofits." />
<meta property="og:url" content="https://www.giveready.org/guides" />
<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; color: #111; line-height: 1.6; }
  h1 { font-size: 2rem; margin: 0 0 0.5rem; }
  .lede { color: #444; margin: 0 0 1.5rem; }
  ul { list-style: none; padding: 0; }
  li { padding: 1rem 0; border-bottom: 1px solid #eee; }
  li h3 { margin: 0; font-size: 1.1rem; }
  li h3 a { color: #111; text-decoration: none; }
  li h3 a:hover { color: #059669; }
  .desc { color: #444; margin: 0.3rem 0 0; font-size: 0.95rem; }
  .date { color: #666; margin: 0.3rem 0 0; font-size: 0.8rem; }
  .empty { color: #666; font-style: italic; }
  .empty a { color: #059669; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e5e5; font-size: 0.85rem; color: #666; }
  footer a { color: #059669; text-decoration: none; }
</style>
</head>
<body>
<h1>Guides</h1>
<p class="lede">Practical guides for finding, verifying, and donating to nonprofits.</p>
<ul>
${listHtml}
</ul>
<footer>
<a href="/">GiveReady home</a> &middot; <a href="/causes">Cause areas</a> &middot; <a href="/AGENTS.md">For agents</a>
${OPERATOR_FOOTER_PLAIN}
</footer>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=900, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}
