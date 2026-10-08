#!/usr/bin/env python3
"""One-off migration for the 2026-10 redesign (theme "yiqun").

Rewrites every post's front matter from the LoveIt shape (categories/tags/
featuredImage) to the new shape (series/issue/url/aliases/wechat), using the
WeChat album cache in data/wechat_albums.json as the source of truth for
titles, dates and issue numbers. Also removes duplicate files and cleans
leftovers from post bodies.

Usage: python3 scripts/migrate-redesign.py <old-permalinks.csv> [--dry-run]
The CSV is the output of `hugo list all` taken on main before the redesign.
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = "--dry-run" in sys.argv
CSV_PATH = sys.argv[1]

# album name on WeChat -> (series name on site, url prefix)
ALBUMS = {
    "轶周记": ("轶周记", "zhouji"),
    "德国记": ("德国记", "deguo"),
    "当牛做马": ("当牛做马", "work"),
    "非正式周报": ("非正式周报", "weekly"),
    "甲状腺手术后": ("甲状腺手术", "thyroid"),
    "为人父母": ("为人父母", "parent"),
    "理财笔记": ("理财笔记", "money"),
    "我和 AI": ("我和AI", "ai"),
    "到此一游": ("到此一游", "trip"),
}
PRIORITY = [v[0] for v in ALBUMS.values()]
PREFIX = {v[0]: v[1] for v in ALBUMS.values()}

# blog title -> WeChat title, for the posts whose titles differ
TITLE_MAP = {
    "德国记#2": "德国生活初体验",
    "德国记#3": "割裂的世界",
    "德国记#4 国王湖": "德国国王湖之行",
    "德国记#5": "德国同事的工作与生活",
    "德国记#11 漂泊": "在德国有一种漂泊的感觉",
    "德国农村是什么样？": "美丽的巴伐利亚",
    "32岁 我得了癌症": "32 岁，我得了甲状腺癌",
    "甲状腺手术花了多少钱？": "甲状腺手术花费竟然还赚了",
    "当定投基金的人遇上个股": "当定投指数的人遇到个股",
    "怎么大胆地做选择": "怎么大胆做选择",
    "最近我越来越觉得，陪孩子的时间最宝贵": "陪孩子的时间最宝贵",
    "2024": "2024 我过得好吗？",
    "把自己当成一只基金：我的人力资本投资组合": "把自己当成一只基金：人力资本投资组合",
    "出差看了两家国产供应商后，我想重新谈谈半导体国产化": "半导体国产化：不只是价格问题",
}

# posts that are in no album: file name -> overrides
NO_ALBUM = {
    "2022-起点.md": {"url": "/p/2022-qidian/"},
    "SMZDM.md": {"url": "/p/iphone-14-pro/"},
    "2022list.md": {"url": "/p/2022-list/"},
    "bayes.md": {"url": "/p/bayes/"},
    "flomo.md": {"url": "/p/flomo/"},
    # no front matter in the vault; year-end dates are nominal
    "一年又一年--2022.md": {"url": "/p/2022/", "date": "2022-12-30T08:00:00+08:00"},
    "一年又一年--2023.md": {"url": "/p/2023/", "date": "2023-12-30T08:00:00+08:00"},
    "甲状腺手术--甲状腺手术一个月后复查tsh-不达标.md": {"series": "甲状腺手术", "issue": 6},
}

# duplicate files: removed file -> surviving file (its old URL becomes an alias)
DUPLICATES = {
    "如果没考上大学怎么办.md": "轶周记--如果没考上大学怎么办-1.md",
    "轶周记--已发布--如果没考上大学怎么办-1.md": "轶周记--如果没考上大学怎么办-1.md",
    "轶周记--已发布--凌晨三点-一场足球和一场没放下的篮球赛.md": "轶周记--凌晨三点-一场足球和一场没放下的篮球赛.md",
    "轶周记--已发布--我开始接受自己慢下来了.md": "轶周记--我开始接受自己慢下来了.md",
    # earlier draft of the same article
    "轶周记--已发布--感觉自己成长变慢了.md": "轶周记--我开始接受自己慢下来了.md",
}

SERIES_PREFIX_RE = re.compile(r"^(轶周记|德国记)\s*[#＃]\s*\d+\s*")
WEEKLY_RE = re.compile(r"^非正式周报\s*(?:N[0O]\.?\s*)?0*(\d+)\s*")


def norm(title):
    title = SERIES_PREFIX_RE.sub("", title)
    return re.sub(r"[\W_]+", "", title).lower()


def display_title(wx_title):
    m = WEEKLY_RE.match(wx_title)
    if m:
        rest = wx_title[m.end():].strip()
        return re.sub(r"\s{2,}", " ", rest) or f"非正式周报 第 {int(m.group(1))} 期"
    return re.sub(r"\s{2,}", " ", SERIES_PREFIX_RE.sub("", wx_title)).strip() or wx_title


def load_albums():
    raw = json.load(open(os.path.join(REPO, "data", "wechat_albums.json"), encoding="utf-8"))
    by_msgid = {}
    for album in raw.values():
        series = ALBUMS[album["name"]][0]
        arts = album["articles"]
        numbered = all(a["pos"] for a in arts)
        ordered = arts if numbered else sorted(arts, key=lambda a: (a["date"], a["msgid"]))
        for i, a in enumerate(ordered, 1):
            entry = by_msgid.setdefault(
                a["msgid"], {"title": a["title"], "date": a["date"], "msgid": a["msgid"], "in": {}}
            )
            entry["in"][series] = int(a["pos"]) if numbered else i
    return by_msgid


def parse(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"---\n(.*?)\n---\n?(.*)", text, re.S)
    fm, body = m.group(1), m.group(2)
    get = lambda k: (re.search(rf"^{k}:\s*(.*)$", fm, re.M) or [None, ""])[1].strip()
    unq = lambda v: json.loads(v) if v.startswith('"') else v
    return {"title": unq(get("title")), "date": get("date"), "summary": unq(get("summary")) if get("summary") else "", "body": body}


def clean_body(body):
    lines = body.replace("\r\n", "\n").split("\n")
    # 关联笔记 belongs to the vault (same rule as stripRelatedNotes in the sync script)
    for i, line in enumerate(lines):
        if re.match(r"^##\s*关联笔记\s*$", line):
            end = next((j for j in range(i + 1, len(lines)) if re.match(r"^##\s+", lines[j])), len(lines))
            lines = lines[:i] + lines[end:]
            break
    lines = [l for l in lines if not re.match(r"^<small>Photo by .*</small>\s*$", l)]
    lines = [l for l in lines if not re.match(r"^!\[\[[^\]]+\]\]\s*$", l)]
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and re.match(r"^# \S", lines[0]):
        lines.pop(0)
    return "\n".join(lines).strip() + "\n"


def q(value):
    return json.dumps(str(value), ensure_ascii=False)


def main():
    albums = load_albums()
    wx_by_norm = {}
    for entry in albums.values():
        wx_by_norm.setdefault(norm(entry["title"]), entry)
    weekly = {e["in"]["非正式周报"]: e for e in albums.values() if "非正式周报" in e["in"]}

    old_url = {}
    for row in csv.DictReader(open(CSV_PATH, encoding="utf-8")):
        old_url[os.path.basename(row["path"])] = urllib.parse.unquote(urllib.parse.urlparse(row["permalink"]).path)

    files = sorted(glob.glob(os.path.join(REPO, "content", "posts", "**", "*.md"), recursive=True))
    files = [f for f in files if os.path.basename(f) != "_index.md"]
    aliases = {os.path.basename(f): [old_url[os.path.basename(f)]] for f in files if os.path.basename(f) in old_url}
    for gone, keep in DUPLICATES.items():
        aliases[keep].append(old_url[gone])

    report, used = [], {}
    for path in files:
        name = os.path.basename(path)
        if name in DUPLICATES:
            if not DRY:
                os.remove(path)
            report.append(("DELETE", name, "->", DUPLICATES[name]))
            continue
        post = parse(path)
        title, date, series, issue, url, msgid = post["title"], post["date"], [], None, None, ""

        wm = WEEKLY_RE.match(title)
        entry = weekly.get(int(wm.group(1))) if wm else wx_by_norm.get(norm(TITLE_MAP.get(title, title)))
        if entry:
            series = sorted(entry["in"], key=PRIORITY.index)
            issue = entry["in"][series[0]]
            title = display_title(entry["title"])
            date = f'{entry["date"]}T08:00:00+08:00'
            msgid = entry["msgid"]
        elif name in NO_ALBUM:
            o = NO_ALBUM[name]
            series = [o["series"]] if "series" in o else []
            issue, url, date = o.get("issue"), o.get("url"), o.get("date", date)
        else:
            raise SystemExit(f"unmatched post: {name} ({title})")

        if series:
            url = f"/{PREFIX[series[0]]}/{issue}/"
        assert url not in used, (url, name, used.get(url))
        used[url] = name

        fm = ["---", f"title: {q(title)}", f"date: {date}", "draft: false"]
        if series:
            fm += [f"series: [{', '.join(q(s) for s in series)}]", f"issue: {issue}"]
        fm += [f"url: {q(url)}", f"aliases: [{', '.join(q(a) for a in aliases[name])}]"]
        if msgid:
            fm.append(f"wechat: {q(msgid)}")
        if post["summary"]:
            fm.append(f"summary: {q(post['summary'])}")
        fm.append("---")
        if not DRY:
            open(path, "w", encoding="utf-8").write("\n".join(fm) + "\n\n" + clean_body(post["body"]))
        report.append((date[:10], url, title, "|", name))

    for row in sorted(report, key=lambda r: str(r[0])):
        print(*row)
    print("posts:", len(used), "deleted:", sum(1 for r in report if r[0] == "DELETE"))
    if not DRY:
        shrink_images()


def shrink_images():
    """Body images over 400 KB: cap the long edge at 1600px and re-encode as JPEG."""
    img_dir = os.path.join(REPO, "static", "images", "obsidian")
    renames = {}
    for name in sorted(os.listdir(img_dir)):
        src = os.path.join(img_dir, name)
        ext = os.path.splitext(name)[1].lower()
        if not os.path.isfile(src) or ext not in (".png", ".jpg", ".jpeg") or os.path.getsize(src) < 400_000:
            continue
        dst = os.path.splitext(src)[0] + ".jpg"
        tmp = dst + ".tmp.jpg"
        subprocess.run(["sips", "-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", tmp],
                       check=True, capture_output=True)
        before = os.path.getsize(src)
        if src != dst:
            os.remove(src)
            renames[name] = os.path.basename(dst)
        os.replace(tmp, dst)
        print(f"image {name}: {before // 1024} KB -> {os.path.getsize(dst) // 1024} KB")
    if renames:
        for path in glob.glob(os.path.join(REPO, "content", "**", "*.md"), recursive=True):
            text = open(path, encoding="utf-8").read()
            new = text
            for old, cur in renames.items():
                new = new.replace(old, cur).replace(urllib.parse.quote(old), urllib.parse.quote(cur))
            if new != text:
                open(path, "w", encoding="utf-8").write(new)


if __name__ == "__main__":
    main()
