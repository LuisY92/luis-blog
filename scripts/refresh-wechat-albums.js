#!/usr/bin/env node

// Refreshes data/wechat_albums.json: the title, order and publish date of every
// article in the 公众号 albums. The sync script uses it to cross-check issue
// numbers. This reads WeChat's public album listing, which is not an official
// API: on any error the cache is left untouched and the exit code is non-zero.

const fs = require("node:fs");
const path = require("node:path");

const ALBUMS_FILE = path.resolve(__dirname, "..", "data", "wechat_albums.json");
const BIZ = "MzI3NjA4MzczMQ==";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

function localDate(seconds) {
  const d = new Date((Number(seconds) + 8 * 3600) * 1000); // Beijing time
  return d.toISOString().slice(0, 10);
}

async function fetchAlbum(albumId) {
  const articles = [];
  let name = "";
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const url = `https://mp.weixin.qq.com/mp/appmsgalbum?action=getalbum&__biz=${BIZ}&album_id=${albumId}&count=20&is_reverse=1&f=json${cursor}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    const resp = (await response.json()).getalbum_resp;
    if (!resp) throw new Error(`unexpected response for album ${albumId}`);
    name = name || resp.base_info?.title || "";
    const list = [].concat(resp.article_list || []);
    articles.push(...list);
    if (resp.continue_flag !== "1" || list.length === 0) break;
    const last = list[list.length - 1];
    cursor = `&begin_msgid=${last.msgid}&begin_itemidx=${last.itemidx}`;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    name,
    articles: articles.map((a) => ({
      pos: a.pos_num || null,
      title: a.title,
      date: localDate(a.create_time),
      msgid: a.msgid,
      url: String(a.url || "").replace("http://", "https://"),
    })),
  };
}

async function main() {
  const cache = JSON.parse(fs.readFileSync(ALBUMS_FILE, "utf8"));
  const next = {};
  for (const albumId of Object.keys(cache)) {
    const album = await fetchAlbum(albumId);
    // An album never shrinks in normal use; treat a shorter list as a bad read.
    if (!album.name || album.articles.length < cache[albumId].articles.length) {
      throw new Error(`album ${albumId} came back incomplete`);
    }
    next[albumId] = album;
  }
  fs.writeFileSync(ALBUMS_FILE, `${JSON.stringify(next, null, 1)}\n`);
  console.log(`Refreshed ${Object.keys(next).length} WeChat albums.`);
}

main().catch((error) => {
  console.error(`WeChat album refresh failed: ${error.message}`);
  process.exit(1);
});
