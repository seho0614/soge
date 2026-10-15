import json, os, sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
sys.path.append(os.environ.get('QA', '/home/claude/qa'))   # v10.31 — consent_ok 등은 원래 qa 폴더
from flow_lib import bo_groups, bo_tab   # v10.29 — 묶음 × 묶음 안 탭(.ad-snb) × 하위 탭
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
BASE=os.environ.get('BO','http://127.0.0.1:5173')
# v10.31 (w6) — 다른 묶음 API 를 쓰는 운영 화면 구역은 그 API 가 없는 사본에서 404 + 「합칠 때 연결」 안내([data-merge-pending])를 냅니다.
#   그 404 는 실패로 세지 않고 merge_pending 으로 따로 남깁니다(합친 뒤에는 0 이어야 함).
MERGE_PENDING=('/api/v1/admin/partner-center/','/api/v1/admin/success-stories','/api/v1/admin/safety/cases')
pend=lambda api:[a for a in api if a.startswith('404 ') and any(m in a for m in MERGE_PENDING)]
real=lambda api:[a for a in api if a not in pend(api)]
out={'tabs':[]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for email in ['admin@x.com','ops@t.local','reviewer@t.local','payout@t.local','member@t.local']:
        pwd='sgb-dev-1234' if email.endswith('x.com') else 'sgb-test-1234'
        ctx=b.new_context(); pg=ctx.new_page(); errs=[]; api=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:160]))
        pg.on('response',lambda r: api.append(f"{r.status} {r.request.method} {urlparse(r.url).path}") if '/api/' in r.url and r.status>=400 else None)
        pg.goto(BASE); pg.wait_for_timeout(800)
        login_visible=pg.locator('form input[name=email]').count()>0
        __import__('consent_ok').agree(email, pwd); pg.fill('input[name=email]',email); pg.fill('input[name=password]',pwd); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
        alert=pg.evaluate("document.querySelector('[role=alert]')?.innerText||''")
        try: pg.wait_for_selector('.bo-head nav button', timeout=15000)
        except Exception: pass
        groups=bo_groups(pg)                                     # v10.29 — [(묶음, [탭 …])]
        tabs=[t for _, ts in groups for t in ts]                 # v10.29 — 묶음 순서대로 탭 글자
        print(email,'login form',login_visible,'tabs',len(tabs),'alert',alert,file=sys.stderr)
        if not tabs:
            out['tabs'].append({'user':email,'tab':None,'alert':alert,'errors':list(errs),'api_fail':list(api)}); ctx.close(); continue
        for t in tabs:
            errs.clear(); api.clear()
            # v10.25 점검 보강(G-170) — 글자가 「들어 있는」 첫 단추가 아니라 **순서 번호**로 누릅니다(「광고」가 「광고 과금」에, 「감사」가 「표본 감사」에 걸렸습니다)
            grp=next(g for g, ts in groups if t in ts)
            okt=bo_tab(pg, t); pg.wait_for_timeout(500)              # v10.29 — 묶음 단추 → .ad-snb 탭(글자 꼭 같은 것)
            main=pg.evaluate("document.querySelector('.bo-main')?.innerText||''")
            errview=pg.evaluate("[...document.querySelectorAll('.bo-main .error, .bo-main [role=alert], .err')].map(e=>e.innerText.slice(0,100))")
            btns=pg.evaluate("[...document.querySelectorAll('.bo-main button')].filter(b=>b.offsetParent).length")
            rec={'user':email,'group':grp,'tab':t,'clicked':okt,'len':len(main),'errors':list(errs),'api_fail':sorted(set(real(api))),'merge_pending':sorted(set(pend(api))),'errview':errview,'buttons':btns,'head':main[:80].replace('\n',' ')}
            out['tabs'].append(rec)
            flag='!!' if (errs or real(api) or errview or not okt) else '  '
            print(flag,email,f'{grp} › {t}',len(main),rec['api_fail'][:4],errs[:1],errview[:1],file=sys.stderr)
            # 20261002 — 하위 탭(.subtabs)도 누릅니다 (2단계까지)
            def snap(label):
                pg.wait_for_timeout(900)
                main=pg.evaluate("document.querySelector('.bo-main')?.innerText||''")
                ev=pg.evaluate("[...document.querySelectorAll('.bo-main .error, .bo-main [role=alert], .err')].map(e=>e.innerText.slice(0,100))")
                r={'user':email,'tab':label,'len':len(main),'errors':list(errs),'api_fail':sorted(set(real(api))),'merge_pending':sorted(set(pend(api))),'errview':ev,
                   'buttons':pg.evaluate("[...document.querySelectorAll('.bo-main button')].filter(b=>b.offsetParent).length"),'head':main[:80].replace('\n',' ')}
                out['tabs'].append(r)
                print('!!' if (errs or real(api) or ev) else '  ',email,label,r['api_fail'][:4],errs[:1],ev[:1],file=sys.stderr)
            subs=pg.evaluate("document.querySelectorAll('.bo-main .subtabs').length ? [...document.querySelectorAll('.bo-main .subtabs')[0].querySelectorAll('button:not([data-out])')].map(b=>b.innerText) : []")   # v10.31 — 다른 탭으로 옮기는 단추(data-out) 빼고
            for sname in (subs or [])[1:] + (subs or [])[:1]:
                errs.clear(); api.clear()
                pg.locator('.bo-main .subtabs').first.locator('button:not([data-out])').nth(subs.index(sname)).click()
                snap(f'{t} › {sname}')
                subs2=pg.evaluate("document.querySelectorAll('.bo-main .subtabs').length>1 ? [...document.querySelectorAll('.bo-main .subtabs')[1].querySelectorAll('button:not([data-out])')].map(b=>b.innerText) : []")
                for s2 in subs2[1:]:
                    errs.clear(); api.clear()
                    pg.locator('.bo-main .subtabs').nth(1).locator('button:not([data-out])').nth(subs2.index(s2)).click()
                    snap(f'{t} › {sname} › {s2}')
        ctx.close()
    b.close()
json.dump(out,open('admin_final.json','w'),ensure_ascii=False,indent=1)
