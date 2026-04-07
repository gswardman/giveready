#!/usr/bin/env node

/**
 * scrape-emails.js
 *
 * Reads unclaimed-nonprofits.csv, fetches websites for rows that have a URL
 * but no contact email, extracts email addresses from the HTML, and outputs:
 *   - unclaimed-nonprofits-with-emails.csv  (updated CSV)
 *   - update-emails.sql                      (SQL UPDATE statements)
 *
 * Usage:  node scripts/scrape-emails.js
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");

// ── CSV helpers ──────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function escapeCSVField(val) {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// ── Email extraction ─────────────────────────────────────────────────────

function extractEmails(html) {
  // Decode HTML entities for mailto links
  const decoded = html
    .replace(/&#64;/g, "@")
    .replace(/&#46;/g, ".")
    .replace(/\[at\]/gi, "@")
    .replace(/\[dot\]/gi, ".");

  // Broad email regex
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const raw = decoded.match(emailRegex) || [];

  // De-dup, lowercase, filter junk
  const seen = new Set();
  const emails = [];
  for (const e of raw) {
    const lower = e.toLowerCase();
    // Skip image/file extensions, common false positives
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|ttf|eot)$/i.test(lower)) continue;
    if (lower.includes("example.com")) continue;
    if (lower.includes("sentry.io")) continue;
    if (lower.includes("wixpress.com")) continue;
    if (lower.includes("w3.org")) continue;
    if (lower.includes("schema.org")) continue;
    if (lower.includes("googleusercontent.com")) continue;
    if (lower.includes("googleapis.com")) continue;
    if (lower.includes("wordpress.org")) continue;
    if (lower.includes("gravatar.com")) continue;
    if (lower.includes("your-email")) continue;
    if (lower.includes("email@")) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    emails.push(lower);
  }

  // Prioritise likely contact addresses
  const priority = ["info@", "contact@", "hello@", "donate@", "support@", "admin@", "office@", "mail@", "team@", "general@"];
  emails.sort((a, b) => {
    const aIdx = priority.findIndex((p) => a.startsWith(p));
    const bIdx = priority.findIndex((p) => b.startsWith(p));
    const aScore = aIdx >= 0 ? aIdx : 100;
    const bScore = bIdx >= 0 ? bIdx : 100;
    return aScore - bScore;
  });

  return emails;
}

// ── Fetch with timeout & retry ───────────────────────────────────────────

async function fetchPage(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithSubpages(baseUrl) {
  let allHtml = "";

  // Fetch homepage
  try {
    allHtml += await fetchPage(baseUrl);
  } catch (err) {
    process.stderr.write(`    homepage failed: ${err.message}\n`);
    return allHtml;
  }

  // Try common contact sub-pages
  const subpages = ["/contact", "/contact-us", "/about", "/about-us", "/get-involved"];
  for (const path of subpages) {
    try {
      const url = new URL(path, baseUrl).href;
      const html = await fetchPage(url, 10000);
      allHtml += "\n" + html;
      break; // stop after first successful subpage
    } catch {
      // silently skip
    }
  }

  return allHtml;
}

// ── Normalise URL ────────────────────────────────────────────────────────

function normaliseUrl(raw) {
  let url = raw.trim();
  if (!url) return "";
  // Strip trailing # or #/ from URLs like "http://yescarolina.com/#"
  url = url.replace(/#\/?$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  // Ensure trailing slash for bare domains
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === "") parsed.pathname = "/";
    return parsed.href;
  } catch {
    return "";
  }
}

// ── SQL escaping ─────────────────────────────────────────────────────────

function sqlEscape(str) {
  return str.replace(/'/g, "''");
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = resolve(ROOT, "unclaimed-nonprofits.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const header = lines[0];
  const headerFields = parseCSVLine(header);

  // Find column indices
  const colName = headerFields.indexOf("Name");
  const colSlug = headerFields.indexOf("Slug");
  const colWebsite = headerFields.indexOf("Website");
  const colEmail = headerFields.indexOf("Contact Email");

  if (colWebsite < 0 || colEmail < 0) {
    process.stderr.write("ERROR: Could not find Website or Contact Email columns\n");
    process.exit(1);
  }

  const rows = lines.slice(1).map((l) => parseCSVLine(l));

  // Identify targets: have website, no email
  const targets = [];
  for (let i = 0; i < rows.length; i++) {
    const website = (rows[i][colWebsite] || "").trim();
    const email = (rows[i][colEmail] || "").trim();
    if (website && !email) {
      targets.push(i);
    }
  }

  process.stderr.write(`Found ${targets.length} nonprofits with website but no email.\n\n`);

  const sqlStatements = [];
  let foundCount = 0;

  for (let t = 0; t < targets.length; t++) {
    const idx = targets[t];
    const row = rows[idx];
    const name = row[colName] || "";
    const slug = row[colSlug] || "";
    const rawUrl = row[colWebsite] || "";
    const url = normaliseUrl(rawUrl);

    process.stderr.write(`[${t + 1}/${targets.length}] ${name}\n`);
    process.stderr.write(`    URL: ${url}\n`);

    if (!url) {
      process.stderr.write(`    SKIP: invalid URL\n\n`);
      continue;
    }

    try {
      const html = await fetchWithSubpages(url);
      const emails = extractEmails(html);

      if (emails.length > 0) {
        const bestEmail = emails[0];
        row[colEmail] = bestEmail;
        foundCount++;
        process.stderr.write(`    FOUND: ${bestEmail}`);
        if (emails.length > 1) {
          process.stderr.write(` (also: ${emails.slice(1, 4).join(", ")})`);
        }
        process.stderr.write("\n");

        // SQL update
        sqlStatements.push(
          `UPDATE nonprofits SET contact_email = '${sqlEscape(bestEmail)}' WHERE slug = '${sqlEscape(slug)}';`
        );
      } else {
        process.stderr.write(`    NO EMAIL FOUND\n`);
      }
    } catch (err) {
      process.stderr.write(`    ERROR: ${err.message}\n`);
    }

    process.stderr.write("\n");

    // Delay between requests
    if (t < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // ── Write updated CSV ──────────────────────────────────────────────────
  const outputLines = [header];
  for (const row of rows) {
    outputLines.push(row.map(escapeCSVField).join(","));
  }
  const csvOut = resolve(ROOT, "unclaimed-nonprofits-with-emails.csv");
  writeFileSync(csvOut, outputLines.join("\n") + "\n", "utf-8");
  process.stderr.write(`\n✓ Updated CSV written to: ${csvOut}\n`);

  // ── Write SQL ──────────────────────────────────────────────────────────
  const sqlOut = resolve(ROOT, "update-emails.sql");
  const sqlContent =
    `-- Auto-generated email updates from scrape-emails.js\n` +
    `-- Generated: ${new Date().toISOString()}\n` +
    `-- Found ${foundCount} emails from ${targets.length} websites scraped\n\n` +
    sqlStatements.join("\n") +
    "\n";
  writeFileSync(sqlOut, sqlContent, "utf-8");
  process.stderr.write(`✓ SQL updates written to: ${sqlOut}\n`);
  process.stderr.write(`\nDone. Found emails for ${foundCount}/${targets.length} nonprofits.\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.message}\n`);
  process.exit(1);
});
