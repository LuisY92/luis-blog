# Obsidian 同步到博客

本仓库可以从本地 Obsidian 目录同步文章到 Hugo 博客。

默认来源：

```text
/Users/luis/Library/Mobile Documents/iCloud~md~obsidian/Documents/Luis_Zone/轶群说
```

同步规则：

- 跳过 `草稿箱`。
- 同名文章只同步路径更短的一份，避免重复发布。
- 文章写入 `content/posts/yiqunshuo/`。
- Obsidian 图片 `![[...]]` 会复制到 `static/images/obsidian/` 并改成 Hugo 可用的 Markdown 图片链接。
- 图片会从整个 `Luis_Zone` 索引，所以 `images/banner/` 里的公共头图也能找到。
- 新文章的栏目取 Obsidian 一级目录名（`一年又一年`、`生日` 归入 `轶周记`），已发布的文章保持原栏目。

预览同步结果：

```bash
node scripts/sync-obsidian.js --dry-run
```

正式同步：

```bash
node scripts/sync-obsidian.js
./.bin/hugo --minify
git status
```

如果要连草稿箱一起同步：

```bash
node scripts/sync-obsidian.js --include-drafts
```

如果 Obsidian 路径变化，可以用环境变量覆盖：

```bash
OBSIDIAN_SOURCE="/path/to/轶群说" OBSIDIAN_ASSET_ROOT="/path/to/Luis_Zone" node scripts/sync-obsidian.js
```

发布到线上：

```bash
git add content/posts static/images/obsidian data/wechat_albums.json scripts docs
git commit -m "Sync Obsidian posts"
git push origin main
```

如果命令行 GitHub 凭据不可用，可以继续让 Codex 通过 GitHub 连接器帮你写到远端。

一键发布脚本：

```bash
scripts/publish-obsidian.sh
```

这个脚本会自动执行同步、构建、提交和推送。Obsidian 插件按钮也是调用它。

## 栏目、期号和网址（2026-10 改版后）

同步脚本为每篇文章写入这些 front matter 字段：

| 字段 | 含义 | 规则 |
|---|---|---|
| `series` | 栏目，第一项是主栏目 | 新文章取 Obsidian 一级目录名；已发布的保持不变 |
| `issue` | 期号 | 新文章取该栏目最大期号加 1；补档的文章（已经在公众号合集里）取合集序号。写入后不再变动 |
| `url` | 网址 | `/<栏目前缀>/<期号>/`，前缀来自 `content/series/<栏目>/_index.md` 的 `url` |
| `aliases` | 旧网址 | 改版前的 `/posts/yiqunshuo/...`，保留用于跳转 |
| `wechat` | 公众号文章 id | 在合集缓存里按标题对上后写入；之后标题以已发布的为准 |

栏目的说明、状态、首页排序在 `content/series/<栏目>/_index.md`，每年的阶段名在 `data/years.toml`，首页自我介绍的第一句在 `config.toml` 的 `params.lead`。

期号和公众号合集序号对不上时，同步输出的 `warnings` 里会有一条 `Issue mismatch`，脚本不会自动改。

## 公众号合集缓存

`data/wechat_albums.json` 存着各个合集的标题、序号和发布日期。`scripts/refresh-wechat-albums.js` 负责刷新，发布脚本每次运行会先调它。它读的是微信的公开合集页，不是正式接口，失败时不影响发布。新建了合集要手动把合集 id 加进这个文件。

## 重复和图片

- 目标文件不存在、但已有同标题的文章时，脚本跳过并在 `warnings` 里提示，不会再生成第二份。
- 正文开头的 `# 标题` 会去掉，页面模板自己会显示标题。
- 超过 400 KB 的正文图片会用 `sips` 缩到最长边 1600 像素并转成 JPEG。
- 正文第一行如果是图片，视为头图，同步时去掉。属于文章内容的图片放在第一段文字之后。
- 不再配封面图：不调 Unsplash，不生成 AI 封面，`featuredImage` 字段被忽略。`static/images/obsidian/covers/` 已加入 `.gitignore`。

## 补档：把只在公众号上有的文章放进来

笔记放进对应的栏目目录即可。同步脚本在合集缓存里按标题找到它（或者笔记 frontmatter 里写了 `wechat: <文章 id>`），就用合集里的序号做期号、合集日期做发布日期，同时属于两个合集的文章会带上第二个栏目。算出来的网址如果已经被别的文章占用，脚本跳过并在 `warnings` 里提示。

## 文字封面（公众号推送用）

公众号推送必须有封面。文章自己有配图时用配图；没有配图时用 `scripts/make-cover.py` 生成的文字封面（期号加标题，900×383）。

```bash
/usr/bin/python3 scripts/make-cover.py            # 最新一篇
/usr/bin/python3 scripts/make-cover.py 关键字     # 标题含关键字的最新一篇
/usr/bin/python3 scripts/make-cover.py --og       # 重新生成站点分享图 og-cover.png
```

发布脚本每次运行会为最新一篇生成一张，放在 `Hermes/outputs/轶群说封面/`，命令会打印文件路径。脚本依赖 Pillow，要用系统自带的 `/usr/bin/python3` 运行。
