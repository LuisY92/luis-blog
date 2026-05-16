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

一键发布脚本：

```bash
scripts/publish-obsidian.sh
```

这个脚本会自动执行同步、构建、提交和推送。Obsidian 插件按钮也是调用它。

## 自动头图

同步脚本可以用 Unsplash API 给新文章自动补头图。

1. 去 [Unsplash Developers](https://unsplash.com/developers) 创建应用，拿到 `Access Key`。
2. 在仓库根目录创建 `.env.local`：

```bash
UNSPLASH_ACCESS_KEY="你的 Access Key"
OBSIDIAN_AUTO_COVER=1
```

默认只给新文章补头图，已经发布过且有 `featuredImage` 的文章会保留原图。

如果要给旧文章批量补图：

```bash
node scripts/sync-obsidian.js --auto-cover --backfill-covers
```

脚本会使用 Unsplash API 返回的图片 URL 作为 `featuredImage`，并在文末加入摄影师和 Unsplash 署名。
