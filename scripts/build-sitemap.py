"""Build sitemap.xml for adarna.us from the HTML pages in the repo.

Usage (from anywhere):
    python scripts/build-sitemap.py            # dry run: print the sitemap and a summary
    python scripts/build-sitemap.py --write    # write sitemap.xml at the repo root

A page is listed when it is a public, indexable *.html file:
  - not 404.html, not a googlee*.html verification file, not under internal/
  - not inside a folder that .assetsignore keeps off the site (scripts/, memory/, .claude/, ...)
  - no <meta name="robots"> containing noindex
The URL is https://adarna.us/ plus the clean path (index.html -> /, x.html -> /x, dir/x.html -> /dir/x).
Each page's <link rel="canonical"> is compared with that URL and any mismatch is printed.
<lastmod> is the date of the file's last git commit, or today for a file git has not committed.
"""
import argparse
import datetime
import os
import re
import subprocess
import sys
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://adarna.us'
SKIP_DIRS = {'.git', '.claude', 'node_modules', 'internal', 'scripts', 'memory'}

ROBOTS_RE = re.compile(r'<meta\s+[^>]*name=["\']robots["\'][^>]*>', re.I)
CANON_RE = re.compile(r'<link\s+[^>]*rel=["\']canonical["\'][^>]*>', re.I)
HREF_RE = re.compile(r'href=["\']([^"\']*)["\']', re.I)
CONTENT_RE = re.compile(r'content=["\']([^"\']*)["\']', re.I)


def ignored_dirs():
    """Top-level folder names that .assetsignore keeps off the site."""
    names = set(SKIP_DIRS)
    path = os.path.join(ROOT, '.assetsignore')
    if os.path.isfile(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and line.endswith('/') and '*' not in line:
                names.add(line.strip('/'))
    return names


def clean_url(rel):
    rel = rel.replace(os.sep, '/')
    if rel == 'index.html':
        return BASE + '/'
    if rel.endswith('/index.html'):
        return BASE + '/' + rel[:-len('index.html')]
    return BASE + '/' + rel[:-len('.html')]


def last_commit_date(rel):
    try:
        out = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', rel], cwd=ROOT,
                             capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        out = ''
    return out or datetime.date.today().isoformat()


def is_uncommitted(rel):
    """True when the working copy differs from HEAD (so the last commit date understates the change)."""
    try:
        r = subprocess.run(['git', 'status', '--porcelain', '--', rel], cwd=ROOT,
                           capture_output=True, text=True, timeout=30)
        return bool(r.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


def collect():
    skip = ignored_dirs()
    pages, excluded, mismatches = [], [], []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        top = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/').split('/')[0]
        if top in skip:
            dirnames[:] = []
            continue
        if rel_dir == '.':
            dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith('.')]
        for name in filenames:
            if not name.endswith('.html'):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, '/')
            if rel == '404.html' or re.match(r'googlee.*\.html$', name):
                excluded.append((rel, 'special file'))
                continue
            html = open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()
            head = html[:html.lower().find('</head>')] if '</head>' in html.lower() else html
            robots = ' '.join(CONTENT_RE.findall(' '.join(ROBOTS_RE.findall(head)))).lower()
            if 'noindex' in robots:
                excluded.append((rel, 'noindex'))
                continue
            url = clean_url(rel)
            canon = CANON_RE.findall(head)
            canon_href = HREF_RE.findall(canon[0])[0] if canon and HREF_RE.findall(canon[0]) else None
            if canon_href != url:
                mismatches.append((rel, url, canon_href))
            pages.append((url, rel))
    pages.sort(key=lambda p: (p[0] != BASE + '/', p[0]))
    return pages, excluded, mismatches


def build_xml(pages):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, rel in pages:
        lines += ['  <url>',
                  '    <loc>%s</loc>' % escape(url),
                  '    <lastmod>%s</lastmod>' % last_commit_date(rel),
                  '  </url>']
    lines.append('</urlset>')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--write', action='store_true', help='write sitemap.xml (default: dry run, print only)')
    ap.add_argument('--quiet', action='store_true', help='in a dry run, print the summary without the XML')
    args = ap.parse_args()

    pages, excluded, mismatches = collect()
    xml = build_xml(pages)
    uncommitted = [rel for _, rel in pages if is_uncommitted(rel)]

    if args.write:
        with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(xml)
        print('wrote sitemap.xml with %d URLs' % len(pages))
    else:
        if not args.quiet:
            print(xml)
        print('DRY RUN: sitemap.xml not written (pass --write). %d URLs.' % len(pages))

    print('excluded %d:' % len(excluded))
    for rel, why in sorted(excluded):
        print('   %-45s %s' % (rel, why))
    if uncommitted:
        print('note: %d listed files have uncommitted changes; their lastmod is the last commit date '
              '(re-run after committing for fresh dates)' % len(uncommitted))
    if mismatches:
        print('CANONICAL MISMATCHES %d:' % len(mismatches))
        for rel, url, canon in mismatches:
            print('   %s: expected %s, canonical %s' % (rel, url, canon))
    else:
        print('canonical tags: all match')
    return 1 if mismatches else 0


if __name__ == '__main__':
    sys.exit(main())
