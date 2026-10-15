import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
OUT = os.environ.get("SGB_QA_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")
import json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import bo_groups, bo_tab   # v10.29 — 묶음 × 묶음 안 탭(.ad-snb)
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
BASE=os.environ.get('BO','http://127.0.0.1:5173')
out={'tabs':[]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for email in ['admin@x.com','reviewer@t.local','member@t.local']:
        pwd='sgb-dev-1234' if email.endswith('x.com') else 'sgb-test-1234'
        ctx=b.new_context(); pg=ctx.new_page(); errs=[]; api=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:160]))
        pg.on('response',lambda r: api.append(f"{r.status} {r.request.method} {urlparse(r.url).path}") if '/api/' in r.url and r.status>=400 else None)
        pg.goto(BASE); pg.wait_for_timeout(800)
        login_visible=pg.locator('form input[name=email]').count()>0
        pg.fill('input[name=email]',email); pg.fill('input[name=password]',pwd); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
        alert=pg.evaluate("document.querySelector('[role=alert]')?.innerText||''")
        try: pg.wait_for_selector('.bo-head nav button', timeout=15000)
        except Exception: pass
        groups=bo_groups(pg)                                     # v10.29 — [(묶음, [탭 …])]
        tabs=[t for _, ts in groups for t in ts]                 # v10.29
        print(email,'login form',login_visible,'tabs',len(tabs),'alert',alert,file=sys.stderr)
        if not tabs:
            out['tabs'].append({'user':email,'tab':None,'alert':alert,'errors':list(errs),'api_fail':list(api)}); ctx.close(); continue
        for t in tabs:
            errs.clear(); api.clear()
            okt=bo_tab(pg, t); pg.wait_for_timeout(500)              # v10.29 — 묶음 단추 → .ad-snb 탭
            main=pg.evaluate("document.querySelector('.bo-main')?.innerText||''")
            errview=pg.evaluate("[...document.querySelectorAll('.bo-main .error, .bo-main [role=alert], .err')].map(e=>e.innerText.slice(0,100))")
            btns=pg.evaluate("[...document.querySelectorAll('.bo-main button')].filter(b=>b.offsetParent).length")
            rec={'user':email,'tab':t,'clicked':okt,'len':len(main),'errors':list(errs),'api_fail':sorted(set(api)),'errview':errview,'buttons':btns,'head':main[:80].replace('\n',' ')}
            out['tabs'].append(rec)
            flag='!!' if (errs or api or errview or not okt) else '  '
            print(flag,email,t,len(main),rec['api_fail'][:4],errs[:1],errview[:1],file=sys.stderr)
        ctx.close()
    b.close()
json.dump(out,open(os.path.join(OUT,'admin_crawl.json'),'w'),ensure_ascii=False,indent=1)
