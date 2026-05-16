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
- 文章分类会包含 `轶群说` 和原来的一级目录名。

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
git add content/posts/yiqunshuo static/images/obsidian .github scripts docs
git commit -m "Sync Obsidian posts"
git push origin main
```

如果命令行 GitHub 凭据不可用，可以继续让 Codex 通过 GitHub 连接器帮你写到远端。
