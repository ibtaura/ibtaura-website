"""Link checker for the adarna.us repo, using Cloudflare Workers static-asset rules.

Usage:
    python scripts/check_links.py [ROOT] [--old-urls FILE] [--verbose]

ROOT defaults to the repo root (the parent of this scripts/ folder).

Checks:
  - every internal href, src, srcset, poster, action, inline style url(), CSS url(), JS path string,
    JSON-LD URL and JSON path value resolves under the clean-URL rules
    (/x serves x.html, /dir/x serves dir/x.html, /dir/ serves dir/index.html, /x.html gets a 307)
  - no relative internal links in HTML or JS, and no .html internal links
  - links do not point at a redirect (link to the final URL instead)
  - every JSON-LD block parses
  - _redirects: no duplicate source, no missing target, no chain, no source that shadows a live file
  - every sitemap.xml <loc> is a live, indexable page
  - with --old-urls FILE: every path in FILE (one per line, # comments allowed) is live or redirected

Paths that .assetsignore keeps off the site (scripts/, memory/, ...) count as missing.
Exit code: 0 when clean, 1 when there are problems.
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, OrderedDict
from html.parser import HTMLParser
from urllib.parse import unquote

DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTS = r'(?:www\.)?adarna\.us'
SKIP_SCHEMES = ('#', 'mailto:', 'tel:', 'sms:', 'data:', 'javascript:', 'blob:', 'about:')


class Site:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.ignore_dirs, self.ignore_files = self._read_assetsignore()
        self.redir = OrderedDict()   # static source -> target
        self.splat = []              # (prefix, target) for "/x/*" sources
        self.problems = []
        self._read_redirects()

    # ---------- served files
    def _read_assetsignore(self):
        dirs, files = {'.git', '.claude'}, {'_headers', '_redirects', '.assetsignore'}
        path = os.path.join(self.root, '.assetsignore')
        if os.path.isfile(path):
            for line in open(path, encoding='utf-8'):
                line = line.strip()
                if not line or line.startswith('#') or '*' in line:
                    continue
                (dirs if line.endswith('/') else files).add(line.strip('/'))
        return dirs, files

    def served(self, rel):
        """True when the file at rel (forward slashes) is uploaded as a static asset."""
        parts = rel.split('/')
        if parts[0] in self.ignore_dirs or rel in self.ignore_files or parts[-1] in self.ignore_files:
            return False
        return os.path.isfile(os.path.join(self.root, *parts))

    def live(self, path):
        """Root-absolute decoded path -> kind: 'page', 'file', 'page_html' (307), 'slash' (307 to /x/), None."""
        p = path.lstrip('/')
        if p == '' or path.endswith('/'):
            return 'page' if self.served(p + 'index.html') else None
        if self.served(p):
            if p.endswith('/index.html'):
                return 'page_html'
            return 'page_html' if p.endswith('.html') else 'file'
        if self.served(p + '.html'):
            return 'page_html' if p.split('/')[-1] == 'index' else 'page'  # /index -> 307 to /
        if self.served(p + '/index.html'):
            return 'slash'
        return None

    def page_file(self, path):
        p = path.lstrip('/')
        if p == '' or path.endswith('/'):
            return p + 'index.html'
        return p + '.html'

    # ---------- redirects
    def _read_redirects(self):
        path = os.path.join(self.root, '_redirects')
        if not os.path.isfile(path):
            return
        # Cloudflare limits: 2000 static + 100 dynamic rules. A rule is dynamic when its source has a
        # splat (*) or a :placeholder, AND every rule after the first dynamic rule counts as dynamic.
        seen_dynamic, n_dynamic, n_static = False, 0, 0
        for n, line in enumerate(open(path, encoding='utf-8'), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            if len(parts) not in (2, 3):
                self.bad('_redirects', 'line %d' % n, 'malformed rule')
                continue
            src, dst = parts[0], parts[1]
            if '*' in src or re.search(r'/:[A-Za-z]', src):
                seen_dynamic = True
            if seen_dynamic:
                n_dynamic += 1
                if n_dynamic == 101:
                    self.bad('_redirects', 'line %d' % n,
                             'over 100 dynamic rules (Cloudflare build fails); move splat/:placeholder rules to the END')
            else:
                n_static += 1
                if n_static == 2001:
                    self.bad('_redirects', 'line %d' % n, 'over 2000 static rules (Cloudflare limit)')
            if src.endswith('/*'):
                self.splat.append((src[:-1], dst))
            elif src in self.redir:
                self.bad('_redirects', src, 'duplicate source')
            else:
                self.redir[src] = dst

    def redirected(self, path):
        """Return the redirect target for a decoded path, or None."""
        for cand in (path, quote_path(path)):
            if cand in self.redir:
                return self.redir[cand]
        for prefix, dst in self.splat:
            if path.startswith(prefix):
                return dst
        return None

    def bad(self, where, ref, why):
        self.problems.append((where, ref, why))


def quote_path(p):
    from urllib.parse import quote
    return quote(p, safe="/&'()+,;=@!$*-._~")


class Checker:
    def __init__(self, site):
        self.s = site

    def check(self, ref, where, allow_relative_from=None):
        ref = (ref or '').strip()
        if not ref or ref.lower().startswith(SKIP_SCHEMES):
            return
        m = re.match(r'https?://' + HOSTS + r'(/[^?#\s]*)?', ref, re.I)
        if m:
            path = m.group(1) or '/'
        elif re.match(r'^[a-z][a-z0-9+.-]*:|^//', ref, re.I):
            return  # another host
        else:
            path = re.split(r'[?#]', ref)[0]
            if not path:
                return
            if not path.startswith('/'):
                if allow_relative_from is not None:
                    path = '/' + os.path.normpath(os.path.join(allow_relative_from, path)).replace(os.sep, '/').lstrip('/')
                else:
                    self.s.bad(where, ref, 'relative URL')
                    path = '/' + path
        path = unquote(path)
        kind = self.s.live(path)
        if kind == 'page_html':
            self.s.bad(where, ref, '.html internal link (307)')
        elif kind == 'slash':
            self.s.bad(where, ref, 'missing trailing slash (307)')
        elif kind is None:
            if self.s.redirected(path):
                self.s.bad(where, ref, 'points at a redirect')
            else:
                self.s.bad(where, ref, 'BROKEN')

    def check_js(self, text, where):
        for _, v in re.findall(r'''(['"`])((?:/|assets/)[A-Za-z0-9_][^'"`\s<>]*|[a-z0-9-]+\.html(?:#[^'"`]*)?)\1''', text):
            if v.startswith('//') or '${' in v or '+' in v:
                continue
            self.check(v, where)
        for v in re.findall(r'''(?:href|src)=\\?["']([^"'\\]+)''', text):
            self.check(v, where)
        for u in re.findall(r'https?://' + HOSTS + r'''[^\s"'<>\\`)]*''', text):
            self.check(u, where)

    def check_css(self, text, where, rel_dir):
        for u in re.findall(r'''url\(\s*["']?([^"')]+?)["']?\s*\)''', text):
            if u.startswith(('#', 'data:')):
                continue
            self.check(u, where, allow_relative_from='/' + rel_dir)

    def check_json_values(self, obj, where):
        if isinstance(obj, dict):
            for v in obj.values():
                self.check_json_values(v, where)
        elif isinstance(obj, list):
            for v in obj:
                self.check_json_values(v, where)
        elif isinstance(obj, str):
            if re.match(r'^/[A-Za-z0-9_][^\s]*$', obj) or re.match(r'^https?://' + HOSTS + r'(/|$)', obj):
                self.check(obj, where)


class PageParser(HTMLParser):
    def __init__(self, checker, where):
        super().__init__(convert_charrefs=True)
        self.c, self.where = checker, where
        self.in_script, self.buf, self.in_style = None, [], False
        self.robots = ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('name') or '').lower() == 'robots':
            self.robots += ' ' + (a.get('content') or '').lower()
        for k, v in attrs:
            if v is None:
                continue
            if k in ('href', 'src', 'poster', 'action', 'data-src'):
                self.c.check(v, self.where)
            elif k in ('srcset', 'imagesrcset'):
                for part in v.split(','):
                    if part.strip():
                        self.c.check(part.strip().split()[0], self.where)
            elif k == 'content' and 'adarna.us' in v:
                for u in re.findall(r'https?://' + HOSTS + r'''[^\s"'<>]*''', v):
                    self.c.check(u, self.where)
            elif k == 'style':
                for u in re.findall(r'''url\(\s*["']?([^"')]+)''', v):
                    if not u.startswith(('#', 'data:')):
                        self.c.check(u, self.where)
        if tag == 'script':
            self.in_script, self.buf = (a.get('type') or 'js').lower(), []
        elif tag == 'style':
            self.in_style, self.buf = True, []

    def handle_endtag(self, tag):
        body = ''.join(self.buf)
        if tag == 'script' and self.in_script:
            if self.in_script == 'application/ld+json':
                try:
                    json.loads(body)
                except ValueError as e:
                    self.c.s.bad(self.where, 'ld+json', 'INVALID JSON-LD: %s' % e)
                for u in re.findall(r'https?://' + HOSTS + r'''[^\s"'<>\\]*''', body):
                    self.c.check(u, self.where)
            elif self.in_script in ('js', 'text/javascript', 'module', 'application/javascript'):
                self.c.check_js(body, self.where)
            self.in_script = None
        elif tag == 'style' and self.in_style:
            self.c.check_css(body, self.where, '')
            self.in_style = False

    def handle_data(self, d):
        if self.in_script or self.in_style:
            self.buf.append(d)


def walk_files(site, exts):
    out = []
    for dirpath, dirnames, filenames in os.walk(site.root):
        rel_dir = os.path.relpath(dirpath, site.root).replace(os.sep, '/')
        if rel_dir == '.':
            rel_dir = ''
            dirnames[:] = [d for d in dirnames if d not in site.ignore_dirs]
        for name in filenames:
            if name.lower().endswith(exts):
                rel = (rel_dir + '/' + name).lstrip('/')
                if site.served(rel):
                    out.append(rel)
    return sorted(out)


def main():
    ap = argparse.ArgumentParser(description='Check internal links, redirects and the sitemap of adarna.us.')
    ap.add_argument('root', nargs='?', default=DEFAULT_ROOT, help='site root (default: the repo root)')
    ap.add_argument('--old-urls', metavar='FILE', help='file of old paths that must be live or redirected')
    ap.add_argument('--verbose', action='store_true', help='list every problem, not one per distinct link')
    args = ap.parse_args()

    site = Site(args.root)
    c = Checker(site)
    noindex = set()

    htmls = [f for f in walk_files(site, ('.html',)) if not re.match(r'(.*/)?googlee[0-9a-f]+\.html$', f)]
    for rel in htmls:
        p = PageParser(c, rel)
        p.feed(open(os.path.join(site.root, rel), encoding='utf-8', errors='replace').read())
        if 'noindex' in p.robots:
            noindex.add(rel)
    jss = walk_files(site, ('.js',))
    for rel in jss:
        c.check_js(open(os.path.join(site.root, rel), encoding='utf-8', errors='replace').read(), rel)
    csss = walk_files(site, ('.css',))
    for rel in csss:
        c.check_css(open(os.path.join(site.root, rel), encoding='utf-8', errors='replace').read(), rel,
                    os.path.dirname(rel))
    jsons = walk_files(site, ('.json',))
    for rel in jsons:
        try:
            data = json.load(open(os.path.join(site.root, rel), encoding='utf-8'))
        except ValueError as e:
            site.bad(rel, 'json', 'INVALID JSON: %s' % e)
            continue
        c.check_json_values(data, rel)

    # ---- _redirects
    rules = list(site.redir.items()) + [(pre + '*', dst) for pre, dst in site.splat]
    for src, dst in rules:
        if '*' not in src and site.live(unquote(src)) in ('page', 'file', 'page_html'):
            site.bad('_redirects', src, 'source is a live file (the file shadows the rule)')
        if re.match(r'^https?://', dst) and not re.match(r'^https?://' + HOSTS, dst):
            continue
        target = re.sub(r'^https?://' + HOSTS, '', dst) or '/'
        target = re.split(r'[?#]', target)[0]
        if ':splat' in target:
            continue
        if site.redirected(unquote(target)) and site.live(unquote(target)) is None:
            site.bad('_redirects', src + ' -> ' + dst, 'CHAIN (target is itself redirected)')
            continue
        kind = site.live(unquote(target))
        if kind is None:
            site.bad('_redirects', src + ' -> ' + dst, 'target missing')
        elif kind != 'page' and kind != 'file':
            site.bad('_redirects', src + ' -> ' + dst, 'target is not a clean URL (%s)' % kind)

    # ---- sitemap
    locs = []
    sm = os.path.join(site.root, 'sitemap.xml')
    if os.path.isfile(sm):
        locs = re.findall(r'<loc>\s*(.*?)\s*</loc>', open(sm, encoding='utf-8').read())
        seen = set()
        for u in locs:
            if u in seen:
                site.bad('sitemap.xml', u, 'duplicate loc')
            seen.add(u)
            m = re.match(r'^https://adarna\.us(/[^?#]*)$', u)
            if not m:
                site.bad('sitemap.xml', u, 'loc is not https://adarna.us/...')
                continue
            path = unquote(m.group(1))
            kind = site.live(path)
            if kind != 'page':
                site.bad('sitemap.xml', u, 'loc is not a live page (%s)' % kind)
            elif site.page_file(path) in noindex:
                site.bad('sitemap.xml', u, 'loc is a noindex page')
    else:
        site.bad('sitemap.xml', '-', 'sitemap.xml missing')

    # ---- old URLs
    old_n = 0
    if args.old_urls:
        for line in open(args.old_urls, encoding='utf-8'):
            line = line.split('#', 1)[0].strip()
            if not line:
                continue
            path = re.sub(r'^https?://' + HOSTS, '', line) or '/'
            if not path.startswith('/'):
                path = '/' + path
            path = unquote(path)
            old_n += 1
            if site.live(path) is None and not site.redirected(path):
                site.bad(args.old_urls, path, 'old URL neither live nor redirected')

    # ---- report
    print('root', site.root)
    print('checked: %d html, %d js, %d css, %d json, %d redirect rules (%d static, %d splat), %d sitemap locs%s'
          % (len(htmls), len(jss), len(csss), len(jsons), len(rules), len(site.redir), len(site.splat), len(locs),
             ', %d old URLs' % old_n if args.old_urls else ''))
    probs = site.problems
    print('PROBLEMS', len(probs))
    for why, n in Counter(p[2] for p in probs).most_common():
        print('  %5d  %s' % (n, why))
    shown = set()
    for where, ref, why in probs:
        key = (ref, why)
        if not args.verbose and key in shown:
            continue
        shown.add(key)
        count = sum(1 for p in probs if (p[1], p[2]) == key)
        extra = '' if args.verbose or count == 1 else '  (+%d more files)' % (count - 1)
        print(ascii('%s | %s | %s%s' % (why, ref, where, extra))[1:-1][:300])
    return 1 if probs else 0


if __name__ == '__main__':
    sys.exit(main())
