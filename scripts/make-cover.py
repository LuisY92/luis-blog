#!/usr/bin/python3
"""Text covers in the site's visual style (paper, Songti, one accent colour).

  scripts/make-cover.py               cover for the most recent post
  scripts/make-cover.py 关键字        cover for the newest post whose title contains 关键字
  scripts/make-cover.py --long        only the 2.35:1 panel (900x383 @2x)
  scripts/make-cover.py --square      only the 1:1 panel (383x383 @2x)
  scripts/make-cover.py --og          the site-wide share image (static/images/brand/og-cover.png)
  --out DIR                           where post covers go (default: Hermes/outputs/轶群说封面)

Default output is the two panels side by side: 2570x766 = [2.35:1 消息列表] | [1:1 转发卡片],
each 766px tall with a light divider between them. 公众号 需要两种比例，后台只让上传一张图、
再用裁剪框分别选区域——把两块并排放在一张图上，消息列表的裁剪框拖到左边（x 0–1800）、
转发卡片的拖到右边（x 1804–2570），两边都是排好版的。
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
SEAM = "#E6E1D6"
SEAM_W = 4  # divider between the two panels; light enough to be invisible if a crop clips it
NO_LINE_START = "，。、；：？！）》」』”’…—"

# Geometry per panel. The 1:1 panel is 766px tall like the 2.35:1 one, but only
# 766px wide instead of 1800, so its type runs a size or two smaller and may use
# a third title line.
LONG = dict(
    W=1800, H=766, PAD=96, head_y=80, head_size=46, num_y=84, num_size=44, head_gap=22,
    rule_y=160, title_sizes=(136, 124, 112, 100, 90, 80, 70), max_lines=2, one_line_min=112,
    foot_gap=150, foot_name_y=648, date_y=656, date_size=36,
)
SQUARE = dict(
    W=766, H=766, PAD=72, head_y=54, head_size=38, num_y=58, num_size=36, head_gap=18,
    rule_y=120, title_sizes=(110, 100, 92, 84, 76, 68, 60, 54), max_lines=3, one_line_min=100,
    foot_gap=130, foot_name_y=662, date_y=670, date_size=30,
)


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
    """Break into lines, never starting a line with punctuation.

    Punctuation that would land at a line start may hang past the right margin
    (Chinese convention), but only by half an em — past that, the preceding
    character is moved down with it so the margin stays honest.
    """
    lines, line = [], ""
    for ch in text:
        if draw.textlength(line + ch, font=font) <= width or not line:
            line += ch
            continue
        if ch not in NO_LINE_START:
            lines.append(line)
            line = ch
        elif draw.textlength(line + ch, font=font) - width <= font.size * 0.5:
            line += ch
        elif len(line) > 1:
            lines.append(line[:-1])
            line = line[-1] + ch
        else:
            line += ch
    return lines + [line] if line else lines


def fits_one_line(draw, text, size, width):
    return draw.textlength(text, font=songti(size, BLACK)) <= width


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


def fit_title(draw, title, width, region_h, sizes, max_lines=2, one_line_min=112):
    """Largest size that gives one line, or a balanced break without a stranded tail.

    Never truncates the title: if no size in `sizes` fits within `max_lines`, it
    keeps shrinking until the whole title fits the region height instead.
    """
    # A title that fits on one line at a still-large size reads better than a
    # bigger one broken in the middle of a word.
    for size in sizes:
        if size >= one_line_min and fits_one_line(draw, title, size, width):
            return songti(size, BLACK), [title], size
    fallback = None
    for size in sizes:
        font = songti(size, BLACK)
        if fits_one_line(draw, title, size, width):
            return font, [title], size
        lines = wrap(draw, title, font, width)
        if len(lines) == 2:
            lines = balance(draw, title, font, width) or lines
            if len(lines[-1]) >= 4:
                return font, lines, size
            fallback = fallback or (font, lines, size)
        elif len(lines) <= max_lines:
            fallback = fallback or (font, lines, size)
    if fallback:
        return fallback
    size = sizes[-1]
    while size > 24 and len(wrap(draw, title, songti(size, BLACK), width)) * int(size * 1.28) > region_h:
        size -= 4
    font = songti(size, BLACK)
    return font, wrap(draw, title, font, width), size


def render_panel(post, geom):
    W, H, PAD = geom["W"], geom["H"], geom["PAD"]
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    name = series_names().get(post["series"], post["series"])

    # Menlo has no Chinese glyphs: the column name is set in Songti, the number in Menlo.
    head_font, num_font = songti(geom["head_size"], BOLD), mono(geom["num_size"])
    x = PAD
    if name:
        draw.text((x, geom["head_y"]), name, font=head_font, fill=ACCENT)
        x += draw.textlength(name, font=head_font) + geom["head_gap"]
        draw.text((x, geom["num_y"]), f"No.{post['issue']}", font=num_font, fill=ACCENT)
    else:
        draw.text((x, geom["head_y"]), "轶群说", font=head_font, fill=ACCENT)
    draw.rectangle([PAD, geom["rule_y"], W - PAD, geom["rule_y"] + 3], fill=INK)

    top, bottom = geom["rule_y"] + 3, H - geom["foot_gap"]
    font, lines, size = fit_title(
        draw, post["title"], W - 2 * PAD, bottom - top,
        geom["title_sizes"], geom["max_lines"], geom["one_line_min"],
    )
    line_h = int(size * 1.28)
    y = top + (bottom - top - line_h * len(lines)) // 2
    for line in lines:
        draw.text((PAD, y), line, font=font, fill=INK)
        y += line_h

    draw.rectangle([PAD, H - geom["foot_gap"], W - PAD, H - geom["foot_gap"] + 3], fill=INK)
    draw.text((PAD, geom["foot_name_y"]), "轶群说", font=head_font, fill=INK)
    date = post["date"][:10]
    date_font = mono(geom["date_size"])
    draw.text((W - PAD - draw.textlength(date, font=date_font), geom["date_y"]), date, font=date_font, fill=INK2)
    return img


def post_cover(post, out_dir, mode="both"):
    long_panel, square_panel = render_panel(post, LONG), render_panel(post, SQUARE)
    if mode == "long":
        img = long_panel
    elif mode == "square":
        img = square_panel
    else:
        img = Image.new("RGB", (LONG["W"] + SEAM_W + SQUARE["W"], LONG["H"]), PAPER)
        img.paste(long_panel, (0, 0))
        img.paste(square_panel, (LONG["W"] + SEAM_W, 0))
        ImageDraw.Draw(img).rectangle([LONG["W"], 0, LONG["W"] + SEAM_W - 1, LONG["H"]], fill=SEAM)

    out_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[/\\:*?"<>|\s]+', "-", post["title"]).strip("-")[:40]
    prefix = f"{post['series']}-No{post['issue']}-" if post["series"] else ""
    suffix = {"both": "", "long": "-2.35-1", "square": "-1-1"}[mode]  # never clobber the combined file
    out = out_dir / f"{prefix}{safe}{suffix}.png"
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
    mode = "both"
    for flag, name in (("--long", "long"), ("--square", "square")):
        if flag in args:
            mode = name
            args.remove(flag)
    if "--og" in args:
        print(og_cover())
        return
    print(post_cover(find_post(args[0] if args else ""), out_dir, mode))


if __name__ == "__main__":
    main()
