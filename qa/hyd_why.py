"""수화 오류(#418)가 날 때 무엇이 달랐는지 — 서버가 보낸 HTML 의 글자와 수화 뒤(브라우저가 다시 그린) 글자를 견줍니다. v10.31
   사용: python3 hyd_why.py /mall/list 60   (창 하나 · 몇 개를 동시에 띄우는 것은 hyd_load.sh 처럼 바깥에서)"""
import difflib, html, json, os, re, sys, time
from playwright.sync_api import sync_playwright
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
path = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 60; tag = sys.argv[3] if len(sys.argv) > 3 else '0'
def txt(h):
    h = re.sub(r'(?is)<(script|style|template)\b.*?</\1>', ' ', h); h = re.sub(r'(?is)<!--.*?-->', '', h)
    h = re.sub(r'(?s)<[^>]+>', '\n', h); return [x for x in (html.unescape(l).strip() for l in h.split('\n')) if x]
hits = []; os.makedirs('/tmp/hydw', exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    for i in range(N):
        pg = ctx.new_page(); errs = []; cons = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.on('console', lambda m: cons.append(m.text[:400]) if m.type == 'error' else None)
        r = pg.goto(SITE + path, wait_until='networkidle'); srv = r.text() if r else ''; pg.wait_for_timeout(150)
        if errs or i < 3:
            open(f'/tmp/hydw/{tag}_{i}_{"bad" if errs else "ok"}.html', 'w').write(srv)
        if errs:
            body = pg.evaluate("document.body.innerHTML"); a, c = txt(srv.split('<body', 1)[-1]), txt(body)
            d = [l for l in difflib.unified_diff(a, c, 'server', 'client', n=1, lineterm='') if not l.startswith(('---', '+++'))][:40]
            hits.append({'i': i, 'at': time.strftime('%H:%M:%S'), 'err': errs[:2], 'console': cons[:3], 'diff': d})
            print(f'[{tag}] {i} 오류 — {errs[0][:120]}\n  ' + '\n  '.join(d[:20]), flush=True)
        pg.close()
    b.close()
json.dump(hits, open(f'/tmp/hyd_why_{tag}.json', 'w'), ensure_ascii=False, indent=1)
print(f'[{tag}] {path} 오류 {len(hits)} / {N}', flush=True)
