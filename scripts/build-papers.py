#!/usr/bin/env python3
"""Builds the Papers section of adarna.us from the papers' LaTeX source.

    python3 build_papers.py <latex-dir> <repo>

Writes papers.html, one paper-<slug>.html per paper, and copies each PDF and
figure into assets/papers/. The LaTeX is the subset these three papers use."""
import html, json, os, re, shutil, sys

SRC, REPO = sys.argv[1], sys.argv[2]
DOWNLOADS = os.path.expanduser("~/Downloads")
PAPERS = [
    dict(tex="Paper1_Sleep_Stress_Recovery_Review", slug="sleep-stress-recovery", art="p7", delay="-6s",
         short="Sleep, stress and recovery"),
    dict(tex="Paper2_Cognitive_Enhancement_Claims_Review", slug="cognitive-enhancement-claims", art="p6", delay="-14s",
         short="Cognitive-enhancement claims"),
    dict(tex="Paper3_Work_Movement_Learning_AI_Review", slug="work-movement-learning-ai", art="p2", delay="-22s",
         short="Work, movement, learning and AI"),
]
PUBLISHED = "2026-11-14"
SITE = "https://adarna.us"

# ── LaTeX → HTML ──────────────────────────────────────────────────────────

def braced(s, i):
    """s[i] is '{' (spaces before it are skipped); returns (inside, index after '}')."""
    while i < len(s) and s[i] == " ":
        i += 1
    if i >= len(s) or s[i] != "{":
        return "", i
    depth, j = 0, i
    while j < len(s):
        if s[j] == "\\":
            j += 2
            continue
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    raise ValueError("unbalanced braces: " + s[i:i + 80])

def link_for(raw):
    raw = raw.strip()
    if raw.lower().startswith("doi:"):
        return "https://doi.org/" + raw[4:].strip(), raw
    if raw.startswith("http"):
        return raw, raw
    return "https://" + raw, raw

WRAP = {"textbf": "strong", "emph": "em", "textit": "em", "textsuperscript": "sup", "textsubscript": "sub"}
DROP = {"allowbreak", "noindent", "par", "quad", "qquad", "hfill", "centering", "small", "footnotesize", "scriptsize",
        "normalsize", "raggedright", "selectfont", "itshape", "bfseries", "sffamily", "tightlist", "relax"}
SYMBOL = {"textasciitilde": "~", "textgreater": "&gt;", "textless": "&lt;", "times": "×", "approx": "≈", "leq": "≤",
          "geq": "≥", "rightarrow": "→", "leftrightarrow": "↔", "uparrow": "↑", "downarrow": "↓", "beta": "β", "rho": "ρ",
          "circ": "°", "pm": "±", "textendash": "–", "textemdash": "—", "ldots": "…", "dots": "…"}
UNKNOWN = set()

def typography(t):
    return (t.replace("---", "—").replace("--", "–").replace("``", "“").replace("''", "”").replace("`", "‘"))

def inline(s):
    out, i, run = [], 0, []
    def flush():
        if run:
            out.append(typography(html.escape("".join(run), quote=False)))
            run.clear()
    while i < len(s):
        c = s[i]
        if c == "\\":
            m = re.match(r"\\([a-zA-Z]+)\*?", s[i:])
            if m:
                flush()
                name, j = m.group(1), i + m.end()
                if name in WRAP:
                    arg, j = braced(s, j)
                    out.append(f"<{WRAP[name]}>{inline(arg)}</{WRAP[name]}>")
                elif name in ("url", "href"):
                    arg, j = braced(s, j)
                    href, text = link_for(arg)
                    if name == "href":
                        text_arg, j = braced(s, j)
                        text = text_arg
                    out.append(f' <a href="{html.escape(href)}" target="_blank" rel="noopener">{html.escape(text)}</a>')
                elif name in ("ensuremath", "mbox", "text", "textrm", "textsf", "texttt"):
                    arg, j = braced(s, j)
                    out.append(inline(arg))
                elif name in SYMBOL:
                    out.append(SYMBOL[name])
                    if s[j:j + 2] == "{}":
                        j += 2
                elif name in DROP:
                    if s[j:j + 2] == "{}":
                        j += 2
                elif name in ("vspace", "hspace", "rule", "setlength", "color"):
                    _, j = braced(s, j)
                    if name in ("rule", "setlength"):
                        _, j = braced(s, j)
                else:
                    UNKNOWN.add(name)
                i = j
                continue
            nxt = s[i + 1] if i + 1 < len(s) else ""
            special = {"%": "%", "&": "&", "_": "_", "#": "#", "$": "$", " ": " ", ",": "\u2009", ";": " ", "{": "{", "}": "}"}
            if nxt == "\\":
                flush()
                out.append("<br>")
                i += 2
                if s[i:i + 1] == "[":
                    i = s.index("]", i) + 1
                continue
            run.append(special.get(nxt, nxt))
            i += 2
            continue
        if c == "{":
            flush()
            arg, j = braced(s, i)
            out.append(inline(arg))
            i = j
            continue
        if c == "}":
            i += 1
            continue
        if c == "~":
            run.append("\u00a0")
            i += 1
            continue
        if c == "$":
            j = s.index("$", i + 1)
            flush()
            out.append(inline(s[i + 1:j].replace("^", "")))
            i = j + 1
            continue
        run.append(c)
        i += 1
    flush()
    return re.sub(r"\s+", " ", "".join(out)).strip()

CITE = re.compile(r"\[(\d+(?:\s*[,–]\s*\d+)*)\]")

def cite_links(h):
    def one(m):
        parts = re.split(r"(\s*[,–]\s*)", m.group(1))
        return "[" + "".join(f'<a class="cite" href="#ref-{p}">{p}</a>' if p.isdigit() else p for p in parts) + "]"
    return CITE.sub(one, h)

def slugify(t):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", t).lower()).strip("-")

def table_rows(body):
    body = re.sub(r"\\(toprule|midrule|bottomrule)", "", body)
    rows = []
    for raw in re.split(r"\\\\\s*(?:\n|$)", body):
        raw = raw.strip()
        if not raw:
            continue
        cells = [inline(c.strip()) for c in re.split(r"(?<!\\)&", raw)]
        rows.append(cells)
    return rows

def table_html(caption, label, rows, wide):
    head, body = rows[0], rows[1:]
    th = "".join(f"<th>{re.sub(r'</?strong>', '', c)}</th>" for c in head)
    trs = "".join("<tr>" + "".join(f"<td>{cite_links(c)}</td>" for c in r) + "</tr>" for r in body)
    cls = "paper-table paper-table--wide" if wide else "paper-table"
    return (f'<figure class="{cls}" id="{label.lower().replace(" ", "-").rstrip(".")}">'
            f'<figcaption><b>{label}</b> {cite_links(caption)}</figcaption>'
            f'<div class="paper-table-scroll" tabindex="0" role="region" aria-label="{html.escape(label.rstrip("."))}">'
            f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div></figure>")

def parse(tex_path, slug):
    tex = open(tex_path, encoding="utf-8").read()
    meta = {}
    meta["title"] = inline(re.search(r"\\fontsize\{17\}\{[\d.]+\}\\selectfont\\bfseries\\raggedright (.*?)\\par\}", tex, re.S).group(1))
    meta["author"] = inline(re.search(r"\{\\large (.*?)\\textsuperscript", tex).group(1))
    meta["affiliation"] = inline(re.search(r"\\textsuperscript\{a\}\\,(.*?)\}\\par", tex).group(1))
    info = re.search(r"A\\,R\\,T\\,I\\,C\\,L\\,E.*?\\end\{minipage\}", tex, re.S).group(0)
    meta["type"] = inline(re.search(r"\\textit\{Article type:\}\\\\ (.*?)\\\\", info).group(1))
    meta["status"] = inline(re.search(r"\\textit\{Status:\}\\\\ (.*?)\\\\", info).group(1))
    meta["version"] = inline(re.search(r"\\textit\{Version:\}\\\\ (.*?)\\\\", info).group(1))
    kw = re.search(r"\\textit\{Keywords:\}\\\\\n(.*?)\\end\{minipage\}", info, re.S).group(1)
    meta["keywords"] = [inline(k) for k in re.split(r"\\\\\s*\n?", kw) if k.strip()]
    ab = re.search(r"A\\,B\\,S\\,T\\,R\\,A\\,C\\,T.*?\\setlength\{\\parskip\}\{3pt\}\n(.*?)\\end\{minipage\}", tex, re.S).group(1)
    meta["abstract"] = []
    for p in [p for p in ab.split("\n\n") if p.strip()]:
        m = re.match(r"\\textbf\{(.*?):\}\s*(.*)", p.strip(), re.S)
        meta["abstract"].append((inline(m.group(1)), cite_links(inline(m.group(2)))))
    meta["header"] = inline(re.search(r"\{\\sffamily\\scriptsize (.*?)\}\\par", tex).group(1))
    meta["email"] = re.search(r"E-mail address:\}\s*([^\s]+)", tex).group(1)

    body = tex.split("\\thispagestyle{first}", 1)[1].split("\\end{document}")[0]
    body = body.split("\n", 2)[2]  # drop the corresponding-author footnote line
    lines = body.split("\n")
    out, toc, para = [], [], []
    fig_n, tab_n, tab_prefix, i = 0, 0, "", 0
    in_refs = False

    def end_para():
        if para:
            text = " ".join(para).strip()
            if text:
                out.append(f"<p>{cite_links(inline(text))}</p>")
            para.clear()

    while i < len(lines):
        line = lines[i].rstrip()
        s = line.strip()
        m = re.match(r"\\(section|subsection|subsubsection)\{(.*)\}$", s)
        if m:
            end_para()
            level = {"section": 2, "subsection": 3, "subsubsection": 4}[m.group(1)]
            title = inline(m.group(2))
            sid = slugify(title)
            in_refs = title == "References"
            out.append(f'<h{level} id="{sid}">{title}</h{level}>')
            if level == 2:
                toc.append((sid, title))
            i += 1
            continue
        if s.startswith("\\begin{itemize}") or s.startswith("\\begin{enumerate}"):
            end_para()
            env = "itemize" if "itemize" in s else "enumerate"
            j = i + 1
            chunk = []
            while not lines[j].strip().startswith(f"\\end{{{env}}}"):
                chunk.append(lines[j])
                j += 1
            items = [it.strip() for it in re.split(r"^\s*\\item\b", "\n".join(chunk), flags=re.M) if it.strip()]
            if in_refs:
                lis = []
                for n, it in enumerate(items, 1):
                    h = inline(it)
                    h = re.sub(r"PMID: (\d+)", r'PMID: <a href="https://pubmed.ncbi.nlm.nih.gov/\1/" target="_blank" rel="noopener">\1</a>', h)
                    lis.append(f'<li id="ref-{n}"><span class="ref-n">[{n}]</span> {h}</li>')
                out.append(f'<ol class="paper-refs">{"".join(lis)}</ol>')
            else:
                tag = "ul" if env == "itemize" else "ol"
                out.append(f'<{tag} class="paper-list">' + "".join(f"<li>{cite_links(inline(it))}</li>" for it in items) + f"</{tag}>")
            i = j + 1
            continue
        if s.startswith("\\begin{figure"):
            end_para()
            j = i
            chunk = []
            while not lines[j].strip().startswith("\\end{figure"):
                chunk.append(lines[j])
                j += 1
            block = "\n".join(chunk)
            img = re.search(r"\\includegraphics(?:\[.*?\])?\{(.*?)\}", block).group(1)
            cap_start = block.index("\\caption")
            cap, _ = braced(block, cap_start + len("\\caption"))
            fig_n += 1
            name = os.path.basename(img)
            dest = f"assets/papers/{slug}/{name}"
            os.makedirs(os.path.join(REPO, os.path.dirname(dest)), exist_ok=True)
            shutil.copy2(os.path.join(SRC, img), os.path.join(REPO, dest))
            from PIL import Image
            w, h = Image.open(os.path.join(REPO, dest)).size
            out.append(f'<figure class="paper-figure" id="fig-{fig_n}"><a href="{dest}" target="_blank" rel="noopener">'
                       f'<img src="{dest}" alt="Fig. {fig_n}. {html.escape(re.sub(r"<[^>]+>", "", inline(cap)).split(". ")[0])}" width="{w}" height="{h}" loading="lazy" decoding="async"></a>'
                       f"<figcaption><b>Fig. {fig_n}.</b> {cite_links(inline(cap))}</figcaption></figure>")
            i = j + 1
            continue
        if "\\setcounter{table}{0}" in s:
            end_para()
            tab_n, tab_prefix = 0, "S"
            i += 1
            continue
        if s.startswith("\\begin{table"):
            end_para()
            j = i
            chunk = []
            while not lines[j].strip().startswith("\\end{table"):
                chunk.append(lines[j])
                j += 1
            block = "\n".join(chunk)
            cap, _ = braced(block, block.index("\\caption") + len("\\caption"))
            tb = re.search(r"\\begin\{tabularx\}\{.*?\}\{.*?\}\n(.*?)\\end\{tabularx\}", block, re.S).group(1)
            tab_n += 1
            out.append(table_html(inline(cap), f"Table {tab_prefix}{tab_n}.", table_rows(tb), wide=False))
            i = j + 1
            continue
        if s.startswith("\\begin{longtable}"):
            end_para()
            j = i
            chunk = []
            while not lines[j].strip().startswith("\\end{longtable}"):
                chunk.append(lines[j])
                j += 1
            block = "\n".join(chunk[1:])
            cap, _ = braced(block, block.index("\\caption") + len("\\caption"))
            header = re.search(r"\\toprule\n(.*?)\\\\\s*\n\\midrule\n\\endfirsthead", block, re.S).group(1)
            rows_src = block.split("\\endlastfoot", 1)[1]
            tab_n += 1
            out.append(table_html(inline(cap), f"Table {tab_prefix}{tab_n}.", table_rows(header + "\\\\\n" + rows_src), wide=True))
            i = j + 1
            continue
        if re.match(r"^\{\\(scriptsize|footnotesize)", s) or re.match(r"^\\(onecolumn|twocolumn|renewcommand|clearpage|newpage)\b", s) or s in ("}", "\\end{enumerate}}"):
            end_para()
            i += 1
            continue
        if not s:
            end_para()
            i += 1
            continue
        para.append(s)
        i += 1
    end_para()
    meta["body"] = "\n".join(out)
    meta["toc"] = toc
    return meta

# ── Page shell (from an existing article page, so nav, footer and scripts match) ──

shell = open(os.path.join(REPO, "article-afib.html"), encoding="utf-8").read()
SHELL_HEAD_TAIL = shell[shell.index('<link rel="apple-touch-icon"'):shell.index("<style>")]
SHELL_STYLE = shell[shell.index("<style>") + len("<style>"):shell.index("</style>")]
BODY_TOP = shell[shell.index("</head>"):shell.index('<script src="assets/js/mobile-nav.js"></script>') + len('<script src="assets/js/mobile-nav.js"></script>')]
BODY_END = shell[shell.index("  <!-- Footer -->"):]
BODY_TOP = BODY_TOP.replace('<a href="papers.html" class="nav-link">', '<a href="papers.html" class="nav-link active">')
FIXED_META = shell[:shell.index("<title>")]

def head(title, desc, path, og_type, ld, image):
    url = SITE + path
    t, d = html.escape(title), html.escape(desc)
    return (FIXED_META + f"""<title>{t}</title>
  <meta name="description" content="{d}" />
  <meta name="author" content="Adarna Inc." />
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
  <link rel="canonical" href="{url}" />

  <meta property="og:type" content="{og_type}" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="{t}" />
  <meta property="og:description" content="{d}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:site_name" content="Adarna" />
  <meta property="og:image" content="{image}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{t}" />
  <meta name="twitter:description" content="{d}" />
  <meta name="twitter:image" content="{image}" />

  <script type="application/ld+json">
{json.dumps(ld, indent=2, ensure_ascii=False)}
  </script>

  """ + SHELL_HEAD_TAIL)

PAPER_CSS = r"""
    /* ─── Research papers ────────────────────────────────── */
    /* Masthead: a journal-style rule, the paper's number, then the title */
    .paper-hero-body { padding-top: 36px; }
    .paper-mast {
      display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
      border-bottom: 2px solid #1d1d1f; padding-bottom: 10px; margin: 0 0 28px;
      font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #1d1d1f;
    }
    .paper-mast em { font-style: normal; font-weight: 500; color: #86868b; }
    .paper-num {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 96px; font-weight: 700; line-height: 0.9; letter-spacing: -4px; color: #d2d2d7; margin: 0 0 18px;
    }
    .paper-kicker {
      font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 14px; font-weight: 500; color: #86868b; letter-spacing: 0.02em; margin: 0 0 14px;
    }
    .paper-title { font-size: 34px; letter-spacing: -0.6px; line-height: 1.16; }
    .paper-byline {
      font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 15px; color: #1d1d1f; margin: 18px 0 0;
    }
    .paper-byline span { color: #6e6e73; }
    .paper-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0 0; }
    .paper-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 9px 20px; border-radius: 980px; border: 1px solid #0071E3;
      background: #0071E3; color: #fff; cursor: pointer;
      font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 14px; font-weight: 500; text-decoration: none; transition: background 0.2s ease;
    }
    .paper-btn:hover { background: #0064CC; }
    .paper-btn svg { width: 15px; height: 15px; fill: currentColor; }
    .paper-btn-outline { background: transparent; color: #0071E3; }
    .paper-btn-outline:hover { background: rgba(0,113,227,0.06); }
    .paper-btn:focus-visible { outline: 2px solid #0071e3; outline-offset: 2px; }
    .paper-facts {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;
      margin: 32px 0 0; padding: 20px 0 4px; border-top: 1px solid #e0e0e5;
    }
    .paper-facts dt { font-size: 12px; color: #86868b; margin: 0 0 4px; }
    .paper-facts dd { font-size: 14px; color: #1d1d1f; margin: 0; line-height: 1.4; }

    /* The content column is exactly as wide as the top card */
    .paper-content { max-width: 860px; width: calc(100% - 24px); padding: 40px 0 64px; }
    .paper-content h2, .paper-content h3, .paper-content h4, .paper-refs li, .paper-figure, .paper-table { scroll-margin-top: 104px; }
    .paper-content h4 {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 17px; font-weight: 600; color: #1d1d1f; margin: 32px 0 10px;
    }
    .paper-abstract { background: #F4F5F5; border-radius: 22px; padding: 32px 36px 12px; margin: 0 0 20px; }
    .paper-abstract h2 { margin-top: 0 !important; font-size: 22px !important; }
    .paper-abstract p { font-size: 16px !important; line-height: 1.65 !important; margin-bottom: 16px !important; }
    .paper-keywords { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 40px; padding: 0; list-style: none; }
    .paper-keywords li {
      font-size: 13px; color: #1d1d1f; background: #F4F5F5; border-radius: 980px; padding: 6px 12px; margin: 0 !important;
    }
    .paper-toc { border-top: 1px solid #e0e0e5; border-bottom: 1px solid #e0e0e5; padding: 20px 0; margin: 0 0 8px; }
    .paper-toc p { font-size: 13px !important; color: #86868b !important; margin: 0 0 10px !important; }
    .paper-toc ol { list-style: none; padding: 0; margin: 0 !important; columns: 2; column-gap: 32px; }
    .paper-toc ol li { padding: 0 !important; margin: 0 0 6px !important; font-size: 15px !important; line-height: 1.5 !important; }
    .paper-toc ol li::before { content: none !important; }
    .paper-toc a { color: #1d1d1f; text-decoration: none; }
    .paper-toc a:hover { color: #0071E3; }

    .paper-content a { color: #0071E3; text-decoration: none; }
    .paper-content a:hover { text-decoration: underline; }
    a.cite { font-variant-numeric: tabular-nums; }
    .paper-list { margin: 0 0 24px; padding-left: 22px; }
    .paper-list li {
      font-size: 17px; line-height: 1.7; color: #1d1d1f; margin: 0 0 8px; padding: 0 !important;
    }
    ol.paper-list li::before { content: none !important; }
    ol.paper-list { list-style: decimal; }

    .paper-figure { margin: 40px 0; }
    .paper-figure img { display: block; width: 100%; height: auto; border-radius: 18px; background: #fff; border: 1px solid #ececf0; }
    .paper-figure figcaption, .paper-table figcaption {
      font-size: 14px; line-height: 1.55; color: #6e6e73; margin: 12px 4px 0;
    }
    .paper-figure figcaption b, .paper-table figcaption b { color: #1d1d1f; font-weight: 600; }
    .paper-table { margin: 40px 0; }
    .paper-table figcaption { margin: 0 4px 12px; }
    .paper-table-scroll { overflow-x: auto; border-radius: 18px; background: #F4F5F5; -webkit-overflow-scrolling: touch; }
    .paper-table-scroll:focus-visible { outline: 2px solid #0071e3; outline-offset: 2px; }
    .paper-table table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.45; color: #1d1d1f; }
    .paper-table--wide table { min-width: 820px; }
    .paper-table th {
      text-align: left; font-weight: 600; padding: 14px 12px 10px; border-bottom: 1px solid #d9d9de; vertical-align: bottom;
    }
    .paper-table td { padding: 10px 12px; border-bottom: 1px solid #e6e6ea; vertical-align: top; }
    .paper-table tbody tr:last-child td { border-bottom: 0; }
    .paper-table th:first-child, .paper-table td:first-child { padding-left: 18px; }
    .paper-table th:last-child, .paper-table td:last-child { padding-right: 18px; }

    .paper-refs { list-style: none; padding: 0 !important; margin: 0 0 24px !important; }
    .paper-refs li {
      position: relative; font-size: 14px !important; line-height: 1.55 !important; color: #424245 !important;
      padding-left: 46px !important; margin: 0 0 10px !important; overflow-wrap: anywhere;
    }
    .paper-refs li::before { content: none !important; }
    .paper-refs .ref-n { position: absolute; left: 0; top: 0; color: #86868b; font-variant-numeric: tabular-nums; }
    .paper-refs li:target { background: #fff8d6; border-radius: 8px; }

    .paper-copied { color: #1d1d1f; font-size: 13px; align-self: center; opacity: 0; transition: opacity 0.2s ease; }
    .paper-copied.is-on { opacity: 1; }

    @media (max-width: 768px) {
      .paper-num { font-size: 72px; letter-spacing: -3px; }
      .paper-mast { font-size: 12px; }
      .paper-title { font-size: 28px; }
      .paper-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .paper-abstract { padding: 24px 22px 6px; border-radius: 18px; }
      .paper-toc ol { columns: 1; }
      .paper-content { width: calc(100% - 64px); padding-left: 0; padding-right: 0; }
      .paper-table table { min-width: 600px; }
    }
    @media (max-width: 480px) {
      .paper-num { font-size: 60px; }
      .paper-mast { flex-direction: column; gap: 2px; align-items: flex-start; }
      .paper-title { font-size: 24px; letter-spacing: -0.4px; }
      .paper-list li { font-size: 16px; }
      .paper-content { width: calc(100% - 48px); padding-left: 0; padding-right: 0; }
    }
"""

INDEX_CSS = r"""
    /* ─── Research index ─────────────────────────────────── */
    .research-intro { max-width: 1100px; width: calc(100% - 24px); margin: 66px auto 0; border-radius: 22px; background: #F4F5F5; padding: 56px 56px 48px; }
    .research-intro .paper-kicker { margin-bottom: 10px; }
    .research-intro h1 {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 48px; font-weight: 700; letter-spacing: -1px; color: #1d1d1f; margin: 0 0 14px; line-height: 1.08;
    }
    .research-intro p.lede { font-size: 19px; line-height: 1.5; color: #6e6e73; margin: 0; max-width: 640px; }
    .research-list { max-width: 1100px; width: calc(100% - 24px); margin: 24px auto 0; display: grid; gap: 24px; }
    .research-card {
      border-radius: 22px; overflow: hidden; background: #F4F5F5;
    }
    .research-card-body { padding: 36px 56px 36px; display: flex; flex-direction: column; }
    .research-card .paper-num { font-size: 72px; letter-spacing: -3px; margin-bottom: 14px; }
    .research-card p.summary { max-width: 760px; }
    .research-card h2 {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 24px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.22; margin: 0 0 14px;
    }
    .research-card h2 a { color: #1d1d1f; text-decoration: none; }
    .research-card h2 a:hover { color: #0071E3; }
    .research-card p.summary { font-size: 15px; line-height: 1.6; color: #6e6e73; margin: 0; }
    .research-card .paper-actions { margin-top: auto; padding-top: 24px; }
    .research-card .paper-byline { margin: 0 0 4px; font-size: 14px; }
    @media (max-width: 768px) {
      .research-intro { width: calc(100% - 64px); margin-top: 68px; padding: 40px 28px 32px; border-radius: 18px; }
      .research-list { width: calc(100% - 64px); }
      .research-intro h1 { font-size: 38px; }
      .research-list { gap: 20px; }
      .research-card { border-radius: 18px; }
      .research-card-body { padding: 28px 24px 26px; }
      .research-card h2 { font-size: 21px; }
    }
    @media (max-width: 480px) {
      .research-intro { width: calc(100% - 48px); margin-top: 64px; padding: 32px 22px 28px; }
      .research-list { width: calc(100% - 48px); }
      .research-intro h1 { font-size: 32px; }
      .research-intro p.lede { font-size: 17px; }
      .research-list { gap: 16px; }
    }
"""

DOWNLOAD_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V1.75A.75.75 0 0 1 8 1zM2.75 12.5a.75.75 0 0 1 .75.75v.5c0 .14.11.25.25.25h8.5c.14 0 .25-.11.25-.25v-.5a.75.75 0 0 1 1.5 0v.5A1.75 1.75 0 0 1 12.25 15.5h-8.5A1.75 1.75 0 0 1 2 13.75v-.5a.75.75 0 0 1 .75-.75z"/></svg>'

COPY_JS = """  <script>
    /* Copy this paper's link */
    document.querySelectorAll('[data-copy-link]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var done = btn.parentNode.querySelector('.paper-copied');
        var url = location.origin + location.pathname;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function() {
          done.classList.add('is-on');
          setTimeout(function() { done.classList.remove('is-on'); }, 1600);
        }, function() { window.prompt('Copy this link', url); });
      });
    });
  </script>
"""

def body_end():
    return BODY_END.replace("  <!-- Cookie consent", COPY_JS + "  <!-- Cookie consent", 1)

def build():
    os.makedirs(os.path.join(REPO, "assets/papers"), exist_ok=True)
    cards = []
    for n, p in enumerate(PAPERS, 1):
        num = f"{n:02d}"
        meta = parse(os.path.join(SRC, p["tex"] + ".tex"), p["slug"])
        pdf = f"assets/papers/adarna-{p['slug']}.pdf"
        shutil.copy2(os.path.join(DOWNLOADS, p["tex"] + ".pdf"), os.path.join(REPO, pdf))
        path = f"/paper-{p['slug']}"
        title = meta["title"]
        plain = re.sub(r"<[^>]+>", "", title)
        conclusions = next(t for k, t in meta["abstract"] if k == "Conclusions")
        desc_plain = re.sub(r"<[^>]+>", "", conclusions)
        image = f"{SITE}/assets/papers/{p['slug']}/" + sorted(os.listdir(os.path.join(REPO, f"assets/papers/{p['slug']}")))[0]
        ld = {"@context": "https://schema.org", "@type": "ScholarlyArticle", "headline": plain[:110], "name": plain,
              "author": {"@type": "Person", "name": re.sub(r"<[^>]+>", "", meta["author"]), "affiliation": {"@type": "Organization", "name": "Adarna Inc."}},
              "publisher": {"@type": "Organization", "name": "Adarna Inc.", "url": SITE},
              "datePublished": PUBLISHED, "inLanguage": "en", "keywords": ", ".join(meta["keywords"]),
              "abstract": desc_plain, "url": SITE + path, "encoding": {"@type": "MediaObject", "encodingFormat": "application/pdf", "contentUrl": f"{SITE}/{pdf}"},
              "creativeWorkStatus": re.sub(r"<[^>]+>", "", meta["status"])}
        facts = [("Article type", meta["type"]), ("Status", meta["status"]), ("Version", meta["version"]), ("Published", "14 November 2026")]
        abstract = "".join(f"<p><strong>{k}:</strong> {t}</p>" for k, t in meta["abstract"])
        toc = "".join(f'<li><a href="#{sid}">{t}</a></li>' for sid, t in meta["toc"])
        kws = "".join(f"<li>{k}</li>" for k in meta["keywords"])
        page = (head(f"{plain} — Adarna Papers", desc_plain, path, "article", ld, image)
                + "<style>" + SHELL_STYLE + PAPER_CSS + "  </style>\n" + BODY_TOP + f"""

  <article class="paper">
  <div class="article-hero">
    <div class="article-hero-body paper-hero-body">
      <div class="paper-mast"><span>Adarna Papers</span><em>No. {num} · November 2026</em></div>
      <p class="paper-num" aria-hidden="true">{num}</p>
      <p class="paper-kicker">Review article · Preprint · November 2026</p>
      <h1 class="article-hero-title paper-title">{title}</h1>
      <p class="paper-byline">{meta['author']} <span>· {meta['affiliation']}</span></p>
      <div class="paper-actions">
        <a class="paper-btn" href="{pdf}" download>{DOWNLOAD_SVG} Download PDF</a>
        <a class="paper-btn paper-btn-outline" href="{pdf}" target="_blank" rel="noopener">Open PDF</a>
        <button type="button" class="paper-btn paper-btn-outline" data-copy-link>Copy link</button>
        <span class="paper-copied" aria-live="polite">Link copied</span>
      </div>
      <dl class="paper-facts">{''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in facts)}</dl>
    </div>
  </div>

  <div class="article-content paper-content">
    <section class="paper-abstract" aria-labelledby="abstract"><h2 id="abstract">Abstract</h2>{abstract}</section>
    <ul class="paper-keywords" aria-label="Keywords">{kws}</ul>
    <nav class="paper-toc" aria-label="Contents"><p>Contents</p><ol>{toc}</ol></nav>
{meta['body']}
  </div>
  </article>

""" + body_end())
        open(os.path.join(REPO, f"paper-{p['slug']}.html"), "w", encoding="utf-8").write(page)
        cards.append(f"""
    <article class="research-card">
      <div class="research-card-body">
        <div class="paper-mast"><span>Adarna Papers</span><em>No. {num} · November 2026</em></div>
      <p class="paper-num" aria-hidden="true">{num}</p>
        <p class="paper-kicker">Review article · Preprint · November 2026</p>
        <h2><a href="paper-{p['slug']}.html">{title}</a></h2>
        <p class="paper-byline">{meta['author']} <span>· {meta['affiliation']}</span></p>
        <p class="summary">{conclusions}</p>
        <div class="paper-actions">
          <a class="paper-btn" href="paper-{p['slug']}.html">Read paper</a>
          <a class="paper-btn paper-btn-outline" href="{pdf}" download>{DOWNLOAD_SVG} Download PDF</a>
        </div>
      </div>
    </article>""")
        print(p["slug"], "sections", len(meta["toc"]), "figures", meta["body"].count('class="paper-figure"'),
              "tables", meta["body"].count('class="paper-table'), "refs", meta["body"].count('<li id="ref-'),
              "cites", meta["body"].count('class="cite"'))

    intro = "Evidence-graded reviews from Adarna on what shapes cognitive performance in working adults. Read each paper in full here, or download the PDF."
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Adarna Papers", "url": SITE + "/papers", "description": intro}
    page = (head("Papers — Adarna", intro, "/papers", "website", ld, f"{SITE}/assets/papers/{PAPERS[0]['slug']}/paper1_fig1_evidence_map.png")
            + "<style>" + SHELL_STYLE + PAPER_CSS + INDEX_CSS + "  </style>\n" + BODY_TOP + f"""

  <div class="research-intro">
    <p class="paper-kicker">Adarna Papers</p>
    <h1>Papers</h1>
    <p class="lede">{intro}</p>
  </div>

  <div class="research-list">{''.join(cards)}
  </div>

""" + body_end())
    open(os.path.join(REPO, "papers.html"), "w", encoding="utf-8").write(page)
    if UNKNOWN:
        print("unknown commands dropped:", sorted(UNKNOWN))

build()
