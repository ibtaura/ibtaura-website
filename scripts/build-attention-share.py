"""Share pages and preview images for the Clarus Attention Test.

Run from the repo root:
    uv run --no-project --with pillow python -I scripts/build-attention-share.py            # generate everything
    uv run --no-project --with pillow python -I scripts/build-attention-share.py --sync-scoring
    uv run --no-project --with pillow python -I scripts/build-attention-share.py --check

With no options it writes, for every score n from 40 to 160:
  attention-test/s/<n>.html                       tiny redirect page whose meta tags give the link preview
  assets/images/attention-test/og/<n>.png         1200x630 preview image
plus assets/images/attention-test/og/default.png (no score).

Challenge links look like https://adarna.us/attention-test/s/118?by=Maya. Crawlers don't run JS, so the
meta tags do the preview; a visitor's browser goes straight on to /attention-test?challenge=118&by=Maya.
A valid friend code (f=, 8 chars of [a-hjkmnp-z2-9], for the friends leaderboard) is forwarded too:
/s/118?by=Maya&f=abcd2345 -> /attention-test?challenge=118&by=Maya&f=abcd2345. Anything else in f is dropped.
The score pages are noindex and stay out of sitemap.xml.

--sync-scoring copies assets/js/attention-test/scoring.js to supabase/functions/_shared/scoring.js byte for byte.
--check exits 1 when the two copies differ.

Files are only rewritten when their bytes change, so a second run changes nothing.
The font is the first one found of: Segoe UI (Windows), SF (macOS), Helvetica (macOS), Pillow's default.
Images rendered with different fonts differ slightly, so regenerate on one machine.
"""
import argparse
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://adarna.us'
LOW, HIGH = 40, 160
PAGE_DIR = os.path.join(ROOT, 'attention-test', 's')
OG_DIR = os.path.join(ROOT, 'assets', 'images', 'attention-test', 'og')
SCORING_SRC = os.path.join(ROOT, 'assets', 'js', 'attention-test', 'scoring.js')
SCORING_DST = os.path.join(ROOT, 'supabase', 'functions', '_shared', 'scoring.js')

W, H = 1200, 630
BG = (245, 245, 247)
WHITE = (255, 255, 255)
INK = (29, 29, 31)
GREY = (110, 110, 115)
LIGHT = (134, 134, 139)
GREEN = (52, 199, 89)
ORANGE = (255, 107, 53)
FOOTER = 'adarna.us/attention-test \u00b7 Clarus Health by Adarna Inc.'


# ---------- scoring copy, mirrors scoring.js (percentileOf, bandOf)
def percentile_of(score):
    import math
    x = (score - 100) / 15 / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * abs(x))
    y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-x * x)
    erf = y if x >= 0 else -y
    v = 50 * (1 + erf)
    # JS Math.round: halves round up.
    return min(99, max(1, int(math.floor(v + 0.5))))


def band_of(score):
    if score >= 130:
        return 'Laser focus'
    if score >= 115:
        return 'Sharp'
    if score >= 100:
        return 'Steady'
    if score >= 85:
        return 'A little foggy'
    return 'Running on empty'


# ---------- small file helpers
def write_if_changed(path, data):
    """Write bytes when they differ from what's on disk. Returns True when the file changed."""
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            if f.read() == data:
                return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    return True


def write_text_if_changed(path, text):
    # LF line endings on every machine.
    buf = io.StringIO(newline='\n')
    buf.write(text)
    return write_if_changed(path, buf.getvalue().encode('utf-8'))


# ---------- fonts
class Fonts:
    """Picks one font family per machine, in a fixed order, and hands out sized faces."""

    def __init__(self):
        from PIL import ImageFont
        self.IF = ImageFont
        self.name, self.paths = self._pick()
        self.cache = {}

    def _pick(self):
        win = os.environ.get('WINDIR', r'C:\Windows')
        fonts = os.path.join(win, 'Fonts')
        candidates = [
            ('Segoe UI', {'regular': (os.path.join(fonts, 'segoeui.ttf'), 0, None),
                          'semibold': (os.path.join(fonts, 'seguisb.ttf'), 0, None),
                          'bold': (os.path.join(fonts, 'segoeuib.ttf'), 0, None)}),
            ('SF (SFNS.ttf)', {'regular': ('/System/Library/Fonts/SFNS.ttf', 0, 'Regular'),
                               'semibold': ('/System/Library/Fonts/SFNS.ttf', 0, 'Semibold'),
                               'bold': ('/System/Library/Fonts/SFNS.ttf', 0, 'Bold')}),
            ('Helvetica', {'regular': ('/System/Library/Fonts/Helvetica.ttc', 0, None),
                           'semibold': ('/System/Library/Fonts/Helvetica.ttc', 1, None),
                           'bold': ('/System/Library/Fonts/Helvetica.ttc', 1, None)}),
        ]
        for name, paths in candidates:
            if all(os.path.isfile(p[0]) for p in paths.values()):
                # Segoe has no semibold file on some installs; fall back to bold then.
                return name, paths
            if name == 'Segoe UI' and os.path.isfile(paths['regular'][0]) and os.path.isfile(paths['bold'][0]):
                paths['semibold'] = paths['bold']
                return name, paths
        return "Pillow's default", None

    def get(self, weight, size):
        key = (weight, size)
        if key in self.cache:
            return self.cache[key]
        if self.paths is None:
            font = self.IF.load_default(size=size)
        else:
            path, index, variation = self.paths[weight]
            font = self.IF.truetype(path, size=size, index=index)
            if variation:
                try:
                    font.set_variation_by_name(variation)
                except Exception:
                    pass
        self.cache[key] = font
        return font


# ---------- drawing helpers
def text_width(draw, text, font, tracking=0):
    if not tracking:
        return draw.textlength(text, font=font)
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * (len(text) - 1)


def fit(draw, fonts, text, weight, size, max_w, tracking=0, min_size=10):
    """Largest font size at or below `size` whose text fits in max_w."""
    while size > min_size and text_width(draw, text, fonts.get(weight, size), tracking) > max_w:
        size -= 1
    return fonts.get(weight, size)


def draw_text(draw, xy, text, font, fill, anchor='ls', tracking=0):
    x, y = xy
    if not tracking:
        draw.text((x, y), text, font=font, fill=fill, anchor=anchor)
        return
    w = text_width(draw, text, font, tracking)
    if anchor[0] == 'm':
        x -= w / 2
    elif anchor[0] == 'r':
        x -= w
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill, anchor='l' + anchor[1])
        x += draw.textlength(ch, font=font) + tracking


def wrap(draw, text, font, max_w):
    words, lines, line = text.split(), [], ''
    for word in words:
        cand = (line + ' ' + word).strip()
        if text_width(draw, cand, font) <= max_w or not line:
            line = cand
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def render_card(fonts, score=None):
    """1200x630 preview: the same layout as the canvas post card in share.js, without part scores."""
    from PIL import Image, ImageDraw
    S = 2  # draw at 2x and scale down for smooth edges
    img = Image.new('RGB', (W * S, H * S), BG)
    d = ImageDraw.Draw(img)
    s = lambda v: int(round(v * S))

    # white card
    d.rounded_rectangle((s(40), s(40), s(1160), s(590)), radius=s(36), fill=WHITE)
    left, col_w = 104, 520

    # kicker
    d.ellipse((s(104), s(94), s(122), s(112)), fill=GREEN)
    draw_text(d, (s(136), s(112)), 'ATTENTION TEST', fonts.get('semibold', s(24)), LIGHT, tracking=s(4))

    if score is not None:
        draw_text(d, (s(left), s(172)), 'I scored', fit(d, fonts, 'I scored', 'semibold', s(32), s(col_w)), INK)
        num = str(score)
        draw_text(d, (s(left - 6), s(352)), num, fit(d, fonts, num, 'bold', s(200), s(col_w)), INK)
        band = band_of(score)
        draw_text(d, (s(left), s(420)), band, fit(d, fonts, band, 'bold', s(40), s(col_w)), INK)
        pct = 'Sharper than %d%% of people' % percentile_of(score)
        draw_text(d, (s(left), s(466)), pct, fit(d, fonts, pct, 'regular', s(28), s(col_w)), GREY)
        cta = 'Can you beat it?'
    else:
        head = 'How sharp is your attention right now?'
        size = 64
        while True:
            font = fonts.get('bold', s(size))
            lines = wrap(d, head, font, s(col_w))
            if len(lines) <= 3 or size <= 30:
                break
            size -= 2
        y = 240
        for line in lines:
            draw_text(d, (s(left), s(y)), line, font, INK)
            y += int(size * 1.15)
        cta = 'Take the free 2-minute test'

    # three tiles: what each part tests
    tiles = [('Reaction', 'Tap the dot'), ('Memory', 'Recall digits'), ('Rules', 'Switch fast')]
    tx0, tx1, ty, th, gap = 680, 1096, 96, 104, 16
    for label, sub in tiles:
        d.rounded_rectangle((s(tx0), s(ty), s(tx1), s(ty + th)), radius=s(24), fill=BG)
        d.ellipse((s(tx0 + 28), s(ty + th / 2 - 7), s(tx0 + 42), s(ty + th / 2 + 7)), fill=GREEN)
        draw_text(d, (s(tx0 + 60), s(ty + th / 2)), label, fonts.get('bold', s(32)), INK, anchor='lm')
        draw_text(d, (s(tx1 - 28), s(ty + th / 2)), sub, fit(d, fonts, sub, 'regular', s(24), s(180)), GREY, anchor='rm')
        ty += th + gap

    # call to action (orange pill)
    cfont = fit(d, fonts, cta, 'bold', s(34), s(tx1 - tx0 - 64))
    cw = text_width(d, cta, cfont)
    px0, py0, py1 = tx0, 462, 534
    d.rounded_rectangle((s(px0), s(py0), s(px0) + cw + s(64), s(py1)), radius=s(36), fill=ORANGE)
    draw_text(d, (s(px0 + 32), s((py0 + py1) / 2)), cta, cfont, WHITE, anchor='lm')

    # footer
    draw_text(d, (s(left), s(548)), FOOTER, fit(d, fonts, FOOTER, 'regular', s(20), s(col_w)), LIGHT)

    return img.resize((W, H), Image.LANCZOS)


def png_bytes(img):
    """256-colour palette PNG, optimised. Palette entries close to a brand colour snap to it exactly,
    so the flat areas (page grey, white card, ink, green, orange) keep their true values."""
    q = img.quantize(colors=256, method=1, dither=0)  # 1 = max coverage: lowest error for flat art
    pal = q.getpalette()[:256 * 3]
    keys = (BG, WHITE, INK, GREY, LIGHT, GREEN, ORANGE)
    for i in range(0, len(pal), 3):
        c = pal[i:i + 3]
        for k in keys:
            if max(abs(a - b) for a, b in zip(c, k)) <= 6:
                pal[i:i + 3] = list(k)
                break
    q.putpalette(pal)
    buf = io.BytesIO()
    q.save(buf, 'PNG', optimize=True)
    data = buf.getvalue()
    if len(data) >= 60_000:  # never expected; fall back to full colour if the palette version is big anyway
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)
        data = min(data, buf.getvalue(), key=len)
    return data


# ---------- share pages
def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def page_html(n):
    url = '%s/attention-test/s/%d' % (SITE, n)
    img = '%s/assets/images/attention-test/og/%d.png' % (SITE, n)
    title = 'I scored %d on the Clarus Attention Test. Can you beat it?' % n
    desc = 'A free 2-minute test of reaction, memory and focus by Adarna Inc.'
    alt = 'Clarus Attention Test score card: %d, %s, sharper than %d%% of people.' % (n, band_of(n), percentile_of(n))
    game = '/attention-test?challenge=%d' % n
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}" />
  <meta name="robots" content="noindex, follow" />
  <link rel="canonical" href="{SITE}/attention-test" />
  <meta name="theme-color" content="#f5f5f7" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Adarna" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(desc)}" />
  <meta property="og:image" content="{img}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="{esc(alt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(desc)}" />
  <meta name="twitter:image" content="{img}" />
  <meta name="twitter:image:alt" content="{esc(alt)}" />
  <script>
    (function () {{
      var by = '', f = '';
      try {{
        var q = new URLSearchParams(location.search);
        by = (q.get('by') || '').trim().slice(0, 24);
        f = q.get('f') || '';
        if (!/^[a-hjkmnp-z2-9]{{8}}$/.test(f)) f = '';
      }} catch (e) {{}}
      location.replace('{game}' + (by ? '&by=' + encodeURIComponent(by) : '') + (f ? '&f=' + f : ''));
    }})();
  </script>
  <style>
    body {{ margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #f5f5f7; color: #1d1d1f; font: 17px/1.5 -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif; }}
    a {{ color: #1d1d1f; font-weight: 600; }}
  </style>
</head>
<body>
  <noscript><p><a href="{game}">Take the Clarus Attention Test and try to beat {n}</a></p></noscript>
  <p><a href="{game}">Opening the Clarus Attention Test&hellip;</a></p>
</body>
</html>
'''


def generate():
    from PIL import Image  # noqa: F401  (fail early with a clear error if Pillow is missing)
    fonts = Fonts()
    print('font:', fonts.name)
    changed_pages = changed_images = 0
    total = 0
    sizes = []
    for n in range(LOW, HIGH + 1):
        if write_text_if_changed(os.path.join(PAGE_DIR, '%d.html' % n), page_html(n)):
            changed_pages += 1
    for n in list(range(LOW, HIGH + 1)) + [None]:
        data = png_bytes(render_card(fonts, n))
        name = 'default.png' if n is None else '%d.png' % n
        if write_if_changed(os.path.join(OG_DIR, name), data):
            changed_images += 1
        total += len(data)
        sizes.append((len(data), name))
    count = HIGH - LOW + 1
    print('pages: %d written, %d unchanged (attention-test/s/)' % (changed_pages, count - changed_pages))
    print('images: %d written, %d unchanged (assets/images/attention-test/og/)' % (changed_images, count + 1 - changed_images))
    sizes.sort()
    print('image sizes: total %.1f KB, smallest %s %.1f KB, largest %s %.1f KB'
          % (total / 1024, sizes[0][1], sizes[0][0] / 1024, sizes[-1][1], sizes[-1][0] / 1024))
    over = [nm for sz, nm in sizes if sz >= 60_000]
    if over:
        print('WARNING: over 60 KB:', ', '.join(over))


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def sync_scoring():
    data = read(SCORING_SRC)
    if write_if_changed(SCORING_DST, data):
        print('copied scoring.js -> supabase/functions/_shared/scoring.js (%d bytes)' % len(data))
    else:
        print('supabase/functions/_shared/scoring.js already identical')


def check_scoring():
    if not os.path.isfile(SCORING_DST):
        print('MISSING: supabase/functions/_shared/scoring.js (run --sync-scoring)')
        return 1
    if read(SCORING_SRC) != read(SCORING_DST):
        print('DIFFERENT: assets/js/attention-test/scoring.js and supabase/functions/_shared/scoring.js (run --sync-scoring)')
        return 1
    print('scoring.js copies are identical')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--sync-scoring', action='store_true', help='copy scoring.js to supabase/functions/_shared/')
    ap.add_argument('--check', action='store_true', help='exit 1 when the two scoring.js copies differ')
    args = ap.parse_args()
    if args.check:
        return check_scoring()
    if args.sync_scoring:
        sync_scoring()
        return 0
    generate()
    return 0


if __name__ == '__main__':
    sys.exit(main())
