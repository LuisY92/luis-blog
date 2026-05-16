#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE =
  "/Users/luis/Library/Mobile Documents/iCloud~md~obsidian/Documents/Luis_Zone/轶群说";
const POSTS_DIR = path.join(REPO_ROOT, "content", "posts", "yiqunshuo");
const STATIC_IMAGE_DIR = path.join(REPO_ROOT, "static", "images", "obsidian");
const IMAGE_URL_PREFIX = "/images/obsidian";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

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
          .map((item) => item.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        data[currentKey] = value.replace(/^["']|["']$/g, "");
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

function getExistingDate(target) {
  if (!fs.existsSync(target)) return null;
  const parsed = parseFrontmatter(fs.readFileSync(target, "utf8"));
  return parsed.data.date || null;
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
  const hash = crypto
    .createHash("sha1")
    .update(fs.readFileSync(imagePath))
    .digest("hex")
    .slice(0, 12);
  const safeBase = slugify(stripExt(path.basename(imagePath))).slice(0, 60);
  const fileName = `${safeBase}-${hash}${ext}`;
  const target = path.join(STATIC_IMAGE_DIR, fileName);
  writes.images.set(target, imagePath);
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

  return next;
}

function shouldSkipNote(file) {
  const relParts = path.relative(sourceRoot, file).split(path.sep);
  if (relParts.some((part) => part === "images")) return true;
  if (!includeDrafts && relParts.includes("草稿箱")) return true;
  return path.extname(file).toLowerCase() !== ".md";
}

function makeTargetPath(file) {
  const rel = path.relative(sourceRoot, file);
  const parts = rel.split(path.sep).map((part) => slugify(stripExt(part)));
  return path.join(POSTS_DIR, `${parts.join("--")}.md`);
}

function makePost(file, imageIndex, writes, warnings) {
  const raw = fs.readFileSync(file, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const rel = path.relative(sourceRoot, file);
  const relParts = rel.split(path.sep);
  const title = data.title || stripExt(path.basename(file));
  const category = relParts.length > 1 ? relParts[0] : "轶群说";
  const target = makeTargetPath(file);
  const existingDate = getExistingDate(target);
  const stat = fs.statSync(file);
  const date = existingDate || data.published || data.date || formatDate(stat.birthtimeMs ? stat.birthtime : stat.mtime);
  const tags = Array.from(new Set([...normalizeList(data.tags), category].filter(Boolean)));
  const summary = data.summary ? `summary: ${quote(data.summary)}\n` : "";
  const convertedBody = convertImages(body.trim(), file, imageIndex, writes, warnings);

  const frontmatter = [
    "---",
    `title: ${quote(title)}`,
    `date: ${date}`,
    "draft: false",
    `tags: [${tags.map(quote).join(", ")}]`,
    `categories: [${quote("轶群说")}, ${quote(category)}]`,
    summary.trimEnd(),
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

function main() {
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
  const posts = selected
    .sort((a, b) => path.relative(sourceRoot, a).localeCompare(path.relative(sourceRoot, b), "zh-Hans-CN"))
    .map((file) => makePost(file, imageIndex, writes, warnings));

  if (!dryRun) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    fs.mkdirSync(STATIC_IMAGE_DIR, { recursive: true });
    for (const [target, source] of writes.images) {
      fs.copyFileSync(source, target);
    }
    for (const post of posts) {
      fs.writeFileSync(post.target, post.content);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        sourceRoot,
        assetRoot,
        posts: posts.length,
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

main();
