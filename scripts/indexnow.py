"""Submit adarna.us URLs to IndexNow (Bing, Yandex, Seznam, Naver and others).

Run it after each deploy to main, once the deploy is live on https://adarna.us
(the key file must be reachable, and the pages must already serve the new content).

Usage:
    python scripts/indexnow.py --check-key        # confirm https://adarna.us/<KEY>.txt serves the key
    python scripts/indexnow.py --dry-run          # print the payload for every sitemap.xml <loc>; send nothing
    python scripts/indexnow.py                    # submit every sitemap.xml <loc>
    python scripts/indexnow.py https://adarna.us/press /burnout   # submit only these URLs

The key is the single file named <32 lowercase hex>.txt at the repo root; its content is the key itself.
URLs may be absolute (https://adarna.us/...) or root-relative (/press). Other hosts are rejected.
In Git Bash, "/press" gets rewritten to a Windows path; use full URLs there, or MSYS_NO_PATHCONV=1.
IndexNow accepts at most 10,000 URLs per request. HTTP 200 or 202 means the submission was accepted.
Standard library only.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

HOST = 'adarna.us'
ENDPOINT = 'https://api.indexnow.org/indexnow'
MAX_URLS = 10000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_RE = re.compile(r'^[0-9a-f]{32}\.txt$')
USER_AGENT = 'adarna-indexnow/1.0'


def find_key():
    names = [n for n in os.listdir(ROOT) if KEY_RE.match(n)]
    if len(names) != 1:
        sys.exit('error: expected exactly one <32-hex>.txt key file at %s, found %d: %s'
                 % (ROOT, len(names), ', '.join(names) or 'none'))
    name = names[0]
    with open(os.path.join(ROOT, name), 'rb') as fh:
        key = fh.read().decode('utf-8-sig').strip()
    if key != name[:-4]:
        sys.exit('error: %s does not contain its own name as the key' % name)
    return key


def sitemap_urls():
    path = os.path.join(ROOT, 'sitemap.xml')
    tree = ET.parse(path)
    urls = []
    for el in tree.iter():
        if el.tag.endswith('}loc') or el.tag == 'loc':
            if el.text and el.text.strip():
                urls.append(el.text.strip())
    return urls


def normalise(url):
    if url.startswith('/'):
        url = 'https://' + HOST + url
    m = re.match(r'^https://([^/]+)(/.*)?$', url)
    if not m or m.group(1) != HOST:
        sys.exit('error: %r is not an https://%s URL' % (url, HOST))
    return url


def check_key(key):
    url = 'https://%s/%s.txt' % (HOST, key)
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode('utf-8-sig').strip()
            status = resp.status
    except urllib.error.HTTPError as e:
        print('key check: %s -> HTTP %d (not live yet?)' % (url, e.code))
        return False
    except urllib.error.URLError as e:
        print('key check: %s -> %s' % (url, e.reason))
        return False
    ok = status == 200 and body == key
    print('key check: %s -> HTTP %d, %s' % (url, status, 'matches' if ok else 'DOES NOT match'))
    return ok


def main():
    ap = argparse.ArgumentParser(description='Submit adarna.us URLs to IndexNow.')
    ap.add_argument('urls', nargs='*', help='URLs to submit (default: every <loc> in sitemap.xml)')
    ap.add_argument('--dry-run', action='store_true', help='print the payload and send nothing')
    ap.add_argument('--check-key', action='store_true', help='fetch the live key file and confirm it matches')
    args = ap.parse_args()

    key = find_key()

    if args.check_key:
        sys.exit(0 if check_key(key) else 1)

    urls = [normalise(u) for u in (args.urls or sitemap_urls())]
    urls = list(dict.fromkeys(urls))  # de-duplicate, keep order
    if not urls:
        sys.exit('error: no URLs to submit')
    if len(urls) > MAX_URLS:
        sys.exit('error: %d URLs; IndexNow accepts at most %d per request' % (len(urls), MAX_URLS))

    payload = {
        'host': HOST,
        'key': key,
        'keyLocation': 'https://%s/%s.txt' % (HOST, key),
        'urlList': urls,
    }
    data = json.dumps(payload, indent=2, ensure_ascii=True)

    if args.dry_run:
        print('dry run: POST %s (%d URLs), nothing sent' % (ENDPOINT, len(urls)))
        print(data)
        return

    req = urllib.request.Request(
        ENDPOINT,
        data=data.encode('utf-8'),
        method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode('utf-8', 'replace')
    except urllib.error.URLError as e:
        sys.exit('error: request failed: %s' % e.reason)

    ok = status in (200, 202)
    print('IndexNow: HTTP %d %s (%d URLs)' % (status, 'OK' if ok else 'FAILED', len(urls)))
    if body.strip():
        print(body.strip()[:500].encode('ascii', 'replace').decode('ascii'))
    if not ok:
        print('hints: 400 bad request, 403 key not valid (key file not live?), 422 URLs not on this host, 429 too many requests')
        sys.exit(1)


if __name__ == '__main__':
    main()
