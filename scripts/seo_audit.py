import sys, re, json, glob, os
from html.parser import HTMLParser
from collections import Counter, defaultdict

root = sys.argv[1]

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.d = defaultdict(list); s.in_title=False; s.in_h1=False; s.title=''; s.h1=[]; s.cur=''
        s.in_ld=False; s.ld=[]; s.imgs=0; s.noalt=0; s.lazy=0; s.links=[]
    def handle_starttag(s, t, a):
        a = dict(a)
        if t=='html': s.d['lang'].append(a.get('lang'))
        if t=='title': s.in_title=True
        if t=='h1': s.in_h1=True; s.cur=''
        if t=='meta':
            k = a.get('name') or a.get('property')
            if k: s.d['meta:'+k.lower()].append(a.get('content',''))
        if t=='link':
            r=(a.get('rel') or '').lower()
            s.d['link:'+r].append(a.get('href',''))
            if 'alternate' in r and a.get('hreflang'): s.d['hreflang'].append(a.get('hreflang'))
        if t=='script' and (a.get('type') or '')=='application/ld+json': s.in_ld=True
        if t=='img':
            s.imgs+=1
            if not (a.get('alt') or '').strip() and a.get('alt') is None: s.noalt+=1
            if a.get('loading')=='lazy': s.lazy+=1
        if t=='a' and a.get('href'): s.links.append(a['href'])
    def handle_endtag(s,t):
        if t=='title': s.in_title=False
        if t=='h1': s.in_h1=False; s.h1.append(s.cur.strip())
        if t=='script': s.in_ld=False
    def handle_data(s,x):
        if s.in_title: s.title+=x
        if s.in_h1: s.cur+=x
        if s.in_ld: s.ld.append(x)

sitemap = open(os.path.join(root,'sitemap.xml'),encoding='utf-8').read()
locs = set(re.findall(r'<loc>https://adarna\.us/([^<]*)</loc>', sitemap))
redirects = open(os.path.join(root,'_redirects'),encoding='utf-8').read()

rows=[]; titles=Counter(); descs=Counter()
for f in sorted(g for g in glob.glob(os.path.join(root,'**','*.html'),recursive=True) if not os.path.relpath(g,root).replace(os.sep,'/').startswith(('.claude/','seo_tools/'))):
    name=os.path.relpath(f,root).replace(os.sep,'/'); slug=name[:-5]
    html=open(f,encoding='utf-8',errors='replace').read()
    p=P(); p.feed(html)
    types=[]
    for blob in p.ld:
        try:
            j=json.loads(blob)
            for it in (j if isinstance(j,list) else j.get('@graph',[j])): types.append(it.get('@type'))
        except Exception as e: types.append('INVALID')
    d=p.d
    desc=(d.get('meta:description') or [''])[0]
    title=p.title.strip()
    titles[title]+=1; descs[desc]+=1
    robots=(d.get('meta:robots') or [''])[0]
    r=dict(page=name, kb=round(len(html)/1024), title_len=len(title), title=title[:70], desc_len=len(desc),
           canonical=(d.get('link:canonical') or [''])[0], robots=robots, lang=(d.get('lang') or [None])[0],
           og_title=bool(d.get('meta:og:title')), og_img=bool(d.get('meta:og:image')), og_url=(d.get('meta:og:url') or [''])[0],
           tw=bool(d.get('meta:twitter:card')), h1=len(p.h1), ld=','.join(map(str,types)),
           imgs=p.imgs, noalt=p.noalt, viewport=bool(d.get('meta:viewport')),
           in_sitemap=(slug in locs or (slug=='index' and '' in locs) or name in locs),
           html_links=sum(1 for l in p.links if l.endswith('.html') and not l.startswith('http')))
    rows.append(r)

for r in rows:
    r['dup_title']=titles[r['title'] and next(t for t in titles if t[:70]==r['title'])]>1 if r['title'] else False
print(json.dumps(rows,indent=0))
print('DUP_TITLES', [t for t,c in titles.items() if c>1])
print('DUP_DESCS', [(t[:60],c) for t,c in descs.items() if c>1])
print('SITEMAP_NOT_ON_DISK', sorted(l for l in locs if l and not os.path.exists(os.path.join(root,l+'.html')) and not os.path.exists(os.path.join(root,l))))
