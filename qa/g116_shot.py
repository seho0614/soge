"""G-116 전후 그림 — 베스트매칭(bst) · 사고예방(saf) · 성공현황(win) · 급구급매(urg, 비교용) 위쪽 줄. 사용: python3 g116_shot.py before|after"""
import sys, os
from playwright.sync_api import sync_playwright
tag = sys.argv[1]; P = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
KEYS = {'bst':'베스트매칭','saf':'사고예방','win':'성공현황'}
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width':1280,'height':900})
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://'+P); pg.wait_for_timeout(1500)
    keys = pg.evaluate("Object.keys(__VIEW.screens)")
    for k in KEYS:
        sk = [x for x in keys if x == k] or [x for x in keys if x.startswith(k)]
        pg.evaluate("k=>{location.hash='';__VIEW.paint(k)}", sk[0]); pg.wait_for_timeout(300); pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"); pg.wait_for_timeout(100)
        el = pg.locator('.rrow.qrow').first
        bb = el.bounding_box()
        pg.screenshot(path=f'g116/{tag}_{k}.png', clip={'x':0,'y':max(0,bb['y']-20),'width':1280,'height':min(260,bb['height']+60)})
        info = pg.evaluate("""()=>{const r=document.querySelector('.rrow.qrow');const t=r.querySelector('.qtabs');const h=r.querySelector('h2');
          const hb=h.getBoundingClientRect();let over=false;
          if(t){for(const btn of t.querySelectorAll('button,a')){const b=btn.getBoundingClientRect();if(b.right>hb.left&&b.left<hb.right&&b.bottom>hb.top&&b.top<hb.bottom)over=true}}
          return {tabs:!!t, noq:r.classList.contains('noq'), overlap:over, title:h.textContent}}""")
        print(tag, k, sk[0], info)
    b.close()
