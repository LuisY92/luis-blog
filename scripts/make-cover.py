#!/usr/bin/python3
"""Text covers in the site's visual style (paper, Songti, one accent colour).

  scripts/make-cover.py               cover for the most recent post
  scripts/make-cover.py 关键字        cover for the newest post whose title contains 关键字
  scripts/make-cover.py --og          the site-wide share image (static/images/brand/og-cover.png)
  --out DIR                           where post covers go (default: Hermes/outputs/轶群说封面)

A post cover is 900x383 (2.35:1, what 公众号 asks for), rendered at 2x. It is
meant for posts that have no picture of their own to use as the cover.
Prints the path of the file it wrote. Needs Pillow: run with /usr/bin/python3.
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Hermes/outputs/轶群说封面"
OG_OUT = ROOT / "static/images/brand/og-cover.png"

SONGTI = "/System/Library/Fonts/Supplemental/Songti.ttc"
MENLO = "/System/Library/Fonts/Menlo.ttc"
BLACK, BOLD, REGULAR = 0, 1, 6  # faces inside Songti.ttc

PAPER, INK, INK2, ACCENT = "#F8F6F0", "#1C1A17", "#6A645A", "#9E2B25"
NO_LINE_START = "，。、；：？！）》」』”’…—"


def songti(size, face=BOLD):
    return ImageFont.truetype(SONGTI, size, index=face)


def mono(size):
    return ImageFont.truetype(MENLO, size, index=0)


def front_matter(path):
    text = path.read_text(encoding="utf-8")
    block = text.split("---", 2)[1] if text.startswith("---") else ""
    data = {}
    for line in block.splitlines():
        m = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if m:
            data[m.group(1)] = m.group(2).strip()
    unquote = lambda v: v[1:-1].replace('\\"', '"') if len(v) > 1 and v[0] == v[-1] == '"' else v
    series = re.findall(r'"([^"]+)"', data.get("series", ""))
    return {
        "title": unquote(data.get("title", "")),
        "date": data.get("date", ""),
        "series": series[0] if series else "",
        "issue": data.get("issue", ""),
    }


def series_names():
    names = {}
    for index in (ROOT / "content/series").glob("*/_index.md"):
        block = index.read_text(encoding="utf-8").split("---", 2)[1]
        key = re.search(r'^key:\s*"?([^"\n]+)"?', block, re.M)
        title = re.search(r'^title:\s*"?([^"\n]+)"?', block, re.M)
        if key and title:
            names[key.group(1)] = title.group(1)
    return names


def find_post(keyword):
    posts = [front_matter(p) for p in (ROOT / "content/posts").rglob("*.md") if p.name != "_index.md"]
    posts = [p for p in posts if p["title"] and (not keyword or keyword in p["title"])]
    if not posts:
        sys.exit(f"no post matches: {keyword}")
    return max(posts, key=lambda p: p["date"])


def wrap(draw, text, font, width):
    lines, line = [], ""
    for ch in text:
        if draw.textlength(line + ch, font=font) > width and line and ch not in NO_LINE_START:
            lines.append(line)
            line = ch
        else:
            line += ch
    return lines + [line] if line else lines


def balance(draw, text, font, width):
    """Two lines of similar length, breaking after punctuation when one is near the middle."""
    best = None
    for cut in range(1, len(text)):
        a, b = text[:cut], text[cut:]
        if b[0] in NO_LINE_START or max(draw.textlength(a, font=font), draw.textlength(b, font=font)) > width:
            continue
        cost = abs(draw.textlength(a, font=font) - draw.textlength(b, font=font))
        if a[-1] in "，：；。？！":
            cost -= font.size * 3
        if best is None or cost < best[0]:
            best = (cost, [a, b])
    return best[1] if best else None


def fit_title(draw, title, width, sizes):
    """Largest size that gives one line, or two lines without a stranded last character."""
    # A title that fits on one line at a still-large size reads better than a
    # bigger one broken in the middle of a word.
    for size in sizes:
        if size >= 112 and len(wrap(draw, title, songti(size, BLACK), width)) == 1:
            return songti(size, BLACK), [title], size
    fallback = None
    for size in sizes:
        font = songti(size, BLACK)
        lines = wrap(draw, title, font, width)
        if len(lines) == 1:
            return font, lines, size
        if len(lines) == 2:
            lines = balance(draw, title, font, width) or lines
            if len(lines[-1]) >= 4:
                return font, lines, size
            fallback = fallback or (font, lines, size)
    return fallback or (font, lines[:2], size)


def post_cover(post, out_dir):
    W, H, PAD = 1800, 766, 96
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    name = series_names().get(post["series"], post["series"])

    # Menlo has no Chinese glyphs: the column name is set in Songti, the number in Menlo.
    x = PAD
    if name:
        draw.text((x, 80), name, font=songti(46, BOLD), fill=ACCENT)
        x += draw.textlength(name, font=songti(46, BOLD)) + 22
        draw.text((x, 84), f"No.{post['issue']}", font=mono(44), fill=ACCENT)
    else:
        draw.text((x, 80), "轶群说", font=songti(46, BOLD), fill=ACCENT)
    draw.rectangle([PAD, 160, W - PAD, 163], fill=INK)

    font, lines, size = fit_title(draw, post["title"], W - 2 * PAD, (136, 124, 112, 100, 90, 80, 70))
    line_h = int(size * 1.28)
    y = 163 + (H - 163 - 150 - line_h * len(lines)) // 2
    for line in lines:
        draw.text((PAD, y), line, font=font, fill=INK)
        y += line_h

    draw.rectangle([PAD, H - 150, W - PAD, H - 147], fill=INK)
    draw.text((PAD, H - 118), "轶群说", font=songti(46, BOLD), fill=INK)
    date = post["date"][:10]
    draw.text((W - PAD - draw.textlength(date, font=mono(36)), H - 110), date, font=mono(36), fill=INK2)

    out_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[/\\:*?"<>|\s]+', "-", post["title"]).strip("-")[:40]
    prefix = f"{post['series']}-No{post['issue']}-" if post["series"] else ""
    out = out_dir / f"{prefix}{safe}.png"
    img.save(out, optimize=True)
    return out


def og_cover():
    W, H, PAD = 2400, 1260, 160
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    config = (ROOT / "config.toml").read_text(encoding="utf-8")
    param = lambda key: (re.search(rf'^\s*{key}\s*=\s*"([^"]*)"', config, re.M) or [None, ""])[1]

    draw.text((PAD, 150), "luisy92.win", font=mono(52), fill=INK2)
    draw.rectangle([PAD, 244, W - PAD, 249], fill=INK)
    draw.text((PAD - 8, 320), "轶群说", font=songti(330, BLACK), fill=INK)
    y = 790
    for text in (param("lead"), param("motto")):
        for line in wrap(draw, text, songti(66, REGULAR), W - 2 * PAD):
            draw.text((PAD, y), line, font=songti(66, REGULAR), fill=INK)
            y += 104
    draw.rectangle([PAD, H - 150, W - PAD, H - 145], fill=INK)
    img.resize((1200, 630), Image.LANCZOS).save(OG_OUT, optimize=True)
    return OG_OUT


def main():
    args = sys.argv[1:]
    out_dir = DEFAULT_OUT
    if "--out" in args:
        i = args.index("--out")
        out_dir = Path(args[i + 1]).expanduser()
        del args[i:i + 2]
    if "--og" in args:
        print(og_cover())
        return
    print(post_cover(find_post(args[0] if args else ""), out_dir))


if __name__ == "__main__":
    main()
