#!/usr/bin/env python3
"""Rebuilds assets/search-index.json, which the phone header's search reads, from every page in sitemap.xml.
Run it from the repo root after adding or renaming a page. Not deployed (.assetsignore)."""
import html, json, re
from urllib.parse import urlsplit

items = []
for loc in re.findall(r"<loc>(.*?)</loc>", open("sitemap.xml", encoding="utf-8").read()):
    path = urlsplit(loc).path
    name = "index.html" if path == "/" else path.strip("/") + ".html"
    try:
        page = open(name, encoding="utf-8").read()
    except FileNotFoundError:
        print("skipped, no file:", loc)
        continue
    title = html.unescape(re.search(r"<title>(.*?)</title>", page, re.S).group(1)).strip()
    title = re.sub(r"\s*[—–|]\s*Adarna\b.*$", "", title).strip() or "Adarna"
    desc = re.search(r'<meta\s+name="description"\s+content="(.*?)"', page, re.S)
    items.append({"t": title, "u": path, "d": html.unescape(desc.group(1)).strip() if desc else ""})

json.dump(items, open("assets/search-index.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "pages")
