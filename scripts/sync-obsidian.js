#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE =
  "/Users/luis/Library/Mobile Documents/iCloud~md~obsidian/Documents/Luis_Zone/📦 档案层/轶群说";
const CONTENT_DIR = path.join(REPO_ROOT, "content", "posts");
const POSTS_DIR = path.join(CONTENT_DIR, "yiqunshuo");
const SERIES_DIR = path.join(REPO_ROOT, "content", "series");
const ALBUMS_FILE = path.join(REPO_ROOT, "data", "wechat_albums.json");
const STATIC_IMAGE_DIR = path.join(REPO_ROOT, "static", "images", "obsidian");
const IMAGE_URL_PREFIX = "/images/obsidian";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
// Body images above this size are resized to 1600px and re-encoded as JPEG (macOS sips).
const SHRINK_MIN_BYTES = 400 * 1024;
// Vault folders that are not columns of their own: on WeChat the yearly reviews
// and birthday pieces belong to the 轶周记 album.
const FOLDER_SERIES = new Map([
  ["一年又一年", "轶周记"],
  ["生日", "轶周记"],
]);
// WeChat album name -> series name on the site, where they differ.
const ALBUM_SERIES = new Map([
  ["甲状腺手术后", "甲状腺手术"],
  ["我和 AI", "我和AI"],
]);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const includeDrafts = args.has("--include-drafts");
const sourceRoot = path.resolve(process.env.OBSIDIAN_SOURCE || DEFAULT_SOURCE);
const assetRoot = path.resolve(process.env.OBSIDIAN_ASSET_ROOT || path.dirname(sourceRoot));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    if (entry.isFile()) out.push(full);
  }
  return out;
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

function slugify(value) {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function quote(value) {
  return JSON.stringify(String(value));
}

function unquote(value) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      // fall through to the plain strip below
    }
  }
  return value.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };
  const yaml = raw.slice(4, end).split(/\r?\n/);
  const data = {};
  let currentKey = null;

  for (const line of yaml) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyValue) {
      currentKey = keyValue[1];
      const value = keyValue[2].trim();
      if (!value) {
        data[currentKey] = "";
      } else if (value.startsWith("[") && value.endsWith("]")) {
        data[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map((item) => unquote(item.trim()))
          .filter(Boolean);
      } else {
        data[currentKey] = unquote(value);
      }
      continue;
    }

    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(listItem[1].trim().replace(/^["']|["']$/g, ""));
    }
  }

  return { data, body: raw.slice(end + 4).replace(/^\r?\n/, "") };
}

function getExistingData(target) {
  if (!fs.existsSync(target)) return {};
  return parseFrontmatter(fs.readFileSync(target, "utf8")).data;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(date) {
  return date.toISOString();
}

function normalizeFrontmatterDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildImageIndex(files) {
  const index = new Map();
  for (const file of files) {
    if (!IMAGE_EXTS.has(path.extname(file).toLowerCase())) continue;
    const base = path.basename(file);
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(file);
  }
  return index;
}

function resolveImage(target, notePath, imageIndex) {
  const cleanTarget = decodeURIComponent(target.split("|")[0].trim());
  const withoutRootName = cleanTarget.startsWith("轶群说/")
    ? cleanTarget.slice("轶群说/".length)
    : cleanTarget;

  const candidates = [
    path.resolve(path.dirname(notePath), cleanTarget),
    path.resolve(path.dirname(notePath), "images", cleanTarget),
    path.resolve(sourceRoot, withoutRootName),
    path.resolve(sourceRoot, "images", cleanTarget),
    path.resolve(assetRoot, withoutRootName),
    path.resolve(assetRoot, "images", cleanTarget),
    path.resolve(assetRoot, "images", "banner", cleanTarget),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const byName = imageIndex.get(path.basename(cleanTarget)) || [];
  if (byName.length === 0) return null;

  byName.sort((a, b) => {
    const aSameDir = path.dirname(a) === path.dirname(notePath) ? 0 : 1;
    const bSameDir = path.dirname(b) === path.dirname(notePath) ? 0 : 1;
    return aSameDir - bSameDir || a.length - b.length;
  });
  return byName[0];
}

function copyImage(imagePath, writes) {
  const ext = path.extname(imagePath).toLowerCase();
  const buffer = fs.readFileSync(imagePath);
  const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 12);
  const safeBase = slugify(stripExt(path.basename(imagePath))).slice(0, 60);
  const shrink =
    process.platform === "darwin" &&
    [".png", ".jpg", ".jpeg"].includes(ext) &&
    buffer.length > SHRINK_MIN_BYTES;
  const fileName = `${safeBase}-${hash}${shrink ? ".jpg" : ext}`;
  const target = path.join(STATIC_IMAGE_DIR, fileName);
  writes.images.set(target, { source: imagePath, shrink });
  return `${IMAGE_URL_PREFIX}/${fileName}`;
}

function convertImages(body, notePath, imageIndex, writes, warnings) {
  let next = body.replace(/!\[\[([^\]]+)\]\]/g, (match, target) => {
    const imagePath = resolveImage(target, notePath, imageIndex);
    if (!imagePath) {
      warnings.push(`Missing image for ${path.basename(notePath)}: ${target}`);
      return match;
    }
    const alt = stripExt(path.basename(target.split("|")[0].trim()));
    return `![${alt}](${copyImage(imagePath, writes)})`;
  });

  next = next.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, target) => {
    if (/^(https?:)?\/\//.test(target) || target.startsWith("/")) return match;
    const imagePath = resolveImage(target, notePath, imageIndex);
    if (!imagePath) {
      warnings.push(`Missing image for ${path.basename(notePath)}: ${target}`);
      return match;
    }
    return `![${alt || stripExt(path.basename(target))}](${copyImage(imagePath, writes)})`;
  });

  // Obsidian wikilink images render as block-level, but standard markdown
  // treats an image jammed between text lines as inline inside the same <p>.
  // Force each image onto its own paragraph by padding with blank lines.
  const lines = next.split("\n");
  const out = [];
  const imageLine = /^!\[[^\]]*\]\([^)]+\)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (imageLine.test(line)) {
      if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      if (i + 1 < lines.length && lines[i + 1].trim() !== "") out.push("");
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function shouldSkipNote(file) {
  const relParts = path.relative(sourceRoot, file).split(path.sep);
  if (relParts.some((part) => part === "images")) return true;
  if (!includeDrafts && relParts.includes("草稿箱")) return true;
  if (!includeDrafts) {
    // New flow: drafts live directly in topic folders, marked by frontmatter status: 草稿
    const { data } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    const status = normalizeList(data.status);
    if (status.some((s) => s.includes("草稿"))) return true;
  }
  return path.extname(file).toLowerCase() !== ".md";
}

function makeTargetPath(file) {
  const rel = path.relative(sourceRoot, file);
  const parts = rel.split(path.sep).map((part) => slugify(stripExt(part)));
  return path.join(POSTS_DIR, `${parts.join("--")}.md`);
}

function stripRelatedNotes(body) {
  // The 关联笔记 tail belongs to the Obsidian vault: its [[wikilinks]] do not resolve
  // on the blog and render as literal double brackets. Keep the section in the vault,
  // never in the generated post. Removes from the heading up to the next ## heading.
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*关联笔记\s*$/.test(line));
  if (start === -1) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\s+$/, "");
}

function stripLeadingTitleAndBanner(body) {
  // The page template prints the title, so a leading "# 标题" would repeat it.
  // An image on the first line is a banner: the site is text-first and drops it.
  // A picture that belongs to the article goes after the first paragraph.
  let next = body;
  for (;;) {
    const stripped = next
      .replace(/^\s*# \S[^\n]*(\n+|$)/, "")
      .replace(/^\s*!\[\[[^\]]+\]\][^\S\n]*(\n+|$)/, "")
      .replace(/^\s*!\[[^\]]*\]\([^)]*\)[^\S\n]*(\n+|$)/, "");
    if (stripped === next) return next;
    next = stripped;
  }
}

function normalizeTitle(title) {
  return title.replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

// Columns come from content/series/<name>/_index.md: `key` is the value posts
// carry in `series`, `url` gives the path prefix for that column's posts.
function loadSeries() {
  const series = new Map();
  if (!fs.existsSync(SERIES_DIR)) return series;
  for (const entry of fs.readdirSync(SERIES_DIR, { withFileTypes: true })) {
    const index = path.join(SERIES_DIR, entry.name, "_index.md");
    if (!entry.isDirectory() || !fs.existsSync(index)) continue;
    const { data } = parseFrontmatter(fs.readFileSync(index, "utf8"));
    if (data.key && data.url) series.set(data.key, data.url.replace(/^\/|\/$/g, ""));
  }
  return series;
}

// Everything already published: who owns which title, and the highest issue
// number handed out per column.
function scanPublished() {
  const titles = new Map();
  const maxIssue = new Map();
  const urls = new Map();
  if (!fs.existsSync(CONTENT_DIR)) return { titles, maxIssue, urls };
  for (const file of walk(CONTENT_DIR)) {
    if (path.extname(file) !== ".md" || path.basename(file) === "_index.md") continue;
    const { data } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    if (data.title) titles.set(normalizeTitle(data.title), file);
    if (data.url) urls.set(data.url, file);
    const primary = normalizeList(data.series)[0];
    const issue = parseInt(data.issue, 10);
    if (primary && issue > (maxIssue.get(primary) || 0)) maxIssue.set(primary, issue);
  }
  return { titles, maxIssue, urls };
}

// WeChat titles carry their own numbering ("轶周记#12 书影半年度盘点",
// "非正式周报09 自信与读书"); the site shows the issue separately.
function displayTitle(wechatTitle) {
  const weekly = wechatTitle.match(/^非正式周报\s*(?:N[0O]\.?\s*)?0*(\d+)\s*/);
  if (weekly) {
    const rest = wechatTitle.slice(weekly[0].length).replace(/\s{2,}/g, " ").trim();
    return rest || `非正式周报 第 ${weekly[1]} 期`;
  }
  const stripped = wechatTitle.replace(/^(轶周记|德国记)\s*[#＃]\s*\d+\s*/, "").replace(/\s{2,}/g, " ").trim();
  return stripped || wechatTitle;
}

// The WeChat album cache (scripts/refresh-wechat-albums.js). The blog publishes
// first, so a new post is usually not in it yet; an article that is already on
// WeChat (a backfilled one) takes its column, issue and date from here.
function loadAlbums() {
  const byId = new Map();
  const byTitle = new Map();
  if (!fs.existsSync(ALBUMS_FILE)) return { byId, byTitle };
  for (const album of Object.values(JSON.parse(fs.readFileSync(ALBUMS_FILE, "utf8")))) {
    const series = ALBUM_SERIES.get(album.name) || album.name;
    // Albums that show no numbering on WeChat are numbered by publish date.
    const numbered = album.articles.every((article) => article.pos);
    const ordered = numbered
      ? album.articles
      : [...album.articles].sort((a, b) => `${a.date}${a.msgid}`.localeCompare(`${b.date}${b.msgid}`));
    ordered.forEach((article, index) => {
      if (!byId.has(article.msgid)) {
        const entry = { msgid: article.msgid, title: displayTitle(article.title), date: article.date, issues: new Map() };
        byId.set(article.msgid, entry);
        for (const key of [normalizeTitle(article.title), normalizeTitle(entry.title)]) {
          if (!byTitle.has(key)) byTitle.set(key, entry);
        }
      }
      byId.get(article.msgid).issues.set(series, numbered ? parseInt(article.pos, 10) : index + 1);
    });
  }
  return { byId, byTitle };
}

async function makePost(file, imageIndex, writes, warnings, site) {
  const raw = fs.readFileSync(file, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const rel = path.relative(sourceRoot, file);
  const relParts = rel.split(path.sep);
  const category = relParts.length > 1 ? relParts[0] : "";
  const target = makeTargetPath(file);
  const isNew = !fs.existsSync(target);
  const existingData = getExistingData(target);
  // Once a post is linked to its WeChat article the title follows WeChat.
  const title = (existingData.wechat && existingData.title) || data.title || stripExt(path.basename(file));

  const owner = site.titles.get(normalizeTitle(title));
  if (isNew && owner && owner !== target) {
    warnings.push(`Skipped ${rel}: 「${title}」 is already published as ${path.relative(REPO_ROOT, owner)}`);
    return null;
  }

  // The note can name its WeChat article outright (`wechat: <msgid>`); otherwise match by title.
  const album =
    site.albums.byId.get(String(existingData.wechat || data.wechat || "")) ||
    site.albums.byTitle.get(normalizeTitle(title));
  const wechat = existingData.wechat || (album ? album.msgid : "");

  // A post keeps the column it was published under (including "none");
  // only a brand-new post takes its column from the vault folder.
  let series = normalizeList(existingData.series);
  if (isNew) {
    const folderSeries = FOLDER_SERIES.get(category) || category;
    series = site.series.has(folderSeries) ? [folderSeries] : [];
    if (album) {
      for (const name of album.issues.keys()) {
        if (site.series.has(name) && !series.includes(name)) series.push(name);
      }
    }
  }
  const primary = series[0] || "";
  const albumIssue = album && primary ? album.issues.get(primary) || 0 : 0;
  let issue = parseInt(existingData.issue, 10) || 0;
  if (primary && !issue) {
    // Already on WeChat: same number as in the album. Otherwise the next free one.
    issue = albumIssue || (site.maxIssue.get(primary) || 0) + 1;
  } else if (albumIssue && albumIssue !== issue) {
    warnings.push(`Issue mismatch for 「${title}」: site No.${issue}, WeChat album No.${albumIssue}`);
  }
  if (primary && issue > (site.maxIssue.get(primary) || 0)) site.maxIssue.set(primary, issue);

  const url = existingData.url || (primary ? `/${site.series.get(primary)}/${issue}/` : `/p/${slugify(title)}/`);
  const urlOwner = site.urls.get(url);
  if (urlOwner && urlOwner !== target) {
    warnings.push(`Skipped ${rel}: ${url} already belongs to ${path.relative(REPO_ROOT, urlOwner)}`);
    return null;
  }
  site.urls.set(url, target);
  site.titles.set(normalizeTitle(title), target);
  const aliases = normalizeList(existingData.aliases);

  const existingDate = normalizeFrontmatterDate(existingData.date);
  const stat = fs.statSync(file);
  const date =
    existingDate ||
    normalizeFrontmatterDate(data.published) ||
    normalizeFrontmatterDate(data.date) ||
    (album ? normalizeFrontmatterDate(`${album.date}T08:00:00+08:00`) : null) ||
    formatDate(stat.birthtimeMs ? stat.birthtime : stat.mtime);
  const summary = data.summary || existingData.summary || "";
  const convertedBody = convertImages(
    stripLeadingTitleAndBanner(stripRelatedNotes(body)).trim(),
    file,
    imageIndex,
    writes,
    warnings,
  );

  const frontmatter = [
    "---",
    `title: ${quote(title)}`,
    `date: ${date}`,
    "draft: false",
    primary ? `series: [${series.map(quote).join(", ")}]` : "",
    primary ? `issue: ${issue}` : "",
    `url: ${quote(url)}`,
    aliases.length ? `aliases: [${aliases.map(quote).join(", ")}]` : "",
    wechat ? `wechat: ${quote(wechat)}` : "",
    summary ? `summary: ${quote(summary)}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    source: file,
    target,
    title,
    content: `${frontmatter}\n\n${convertedBody}\n`,
  };
}

async function main() {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Obsidian source not found: ${sourceRoot}`);
  }

  const sourceFiles = walk(sourceRoot);
  const assetFiles = assetRoot === sourceRoot ? sourceFiles : [...sourceFiles, ...walk(assetRoot)];
  const imageIndex = buildImageIndex(assetFiles);
  const markdown = sourceFiles.filter((file) => !shouldSkipNote(file));
  const byTitle = new Map();
  const selected = [];
  const skippedDuplicates = [];

  for (const file of markdown) {
    const title = stripExt(path.basename(file));
    const rel = path.relative(sourceRoot, file);
    const current = byTitle.get(title);
    if (!current) {
      byTitle.set(title, file);
      selected.push(file);
      continue;
    }
    const winner = rel.length < path.relative(sourceRoot, current).length ? file : current;
    const loser = winner === file ? current : file;
    byTitle.set(title, winner);
    const index = selected.indexOf(loser);
    if (index !== -1) selected.splice(index, 1, winner);
    skippedDuplicates.push(path.relative(sourceRoot, loser));
  }

  const writes = { images: new Map() };
  const warnings = [];
  const site = { ...scanPublished(), series: loadSeries(), albums: loadAlbums() };
  const posts = selected
    .sort((a, b) => path.relative(sourceRoot, a).localeCompare(path.relative(sourceRoot, b), "zh-Hans-CN"));
  const builtPosts = [];
  for (const file of posts) {
    const post = await makePost(file, imageIndex, writes, warnings, site);
    if (post) builtPosts.push(post);
  }

  if (!dryRun) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    fs.mkdirSync(STATIC_IMAGE_DIR, { recursive: true });
    for (const [target, { source, shrink }] of writes.images) {
      if (fs.existsSync(target)) continue; // names carry a content hash
      if (shrink) {
        execFileSync("sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "80", source, "--out", target], {
          stdio: "ignore",
        });
      } else {
        fs.copyFileSync(source, target);
      }
    }
    for (const post of builtPosts) {
      fs.writeFileSync(post.target, post.content);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        sourceRoot,
        assetRoot,
        posts: builtPosts.length,
        images: writes.images.size,
        skippedDuplicates,
        warnings,
        output: path.relative(REPO_ROOT, POSTS_DIR),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
