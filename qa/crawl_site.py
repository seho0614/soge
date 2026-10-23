"""사용자 웹 전 페이지 × 역할 순회 + 페이지 간 링크 상호 확인."""
import json, re, subprocess, sys, time
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright
import os
# v10.73 — 주소 · DB 는 환경 변수로(없으면 집 PC 기본값) · 점검판 값은 qa/func_check.sh 가 줌
BASE=os.environ.get('SITE','http://localhost:5174')
DB=os.environ.get('DB','postgresql://sgb:sgb@localhost:5432/sgb')
def q(sql):
    return subprocess.run(['psql',DB,'-tAc',sql],capture_output=True,text=True).stdout.strip().split('\n')[0]
P={
 'listing': q("select id from listings where status='PUBLISHED' and gwan_code='MNY' order by created_at desc limit 1"),
 'request': q("select id from requests where status='PUBLISHED' limit 1"),
 'deal': q("select id from deals limit 1"),
 'contract': q("select id from deal_contracts limit 1") or q("select id from deals limit 1"),
 'conv': q("select id from conversations limit 1") or '00000000-0000-4000-a000-000000000000',
 'svc': q("select id from partner_services limit 1"),
 'post': q("select id from posts order by (state='APPROVED') desc, created_at desc limit 1") or '00000000-0000-4000-a000-000000000000',
 'hprod': q("select code from hlt_products where status='ON_SALE' order by code limit 1"),
 'horder': q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' order by o.created_at desc limit 1") or 'H00000000000',
 # v10.79 — 고치기 화면의 매물: 순회 역할은 매물이 없어(intro 0건 → 전에는 아무 매물이나 골라 intro 도 404) 개발 계정 seller@x.com 의 공개 매물.
 #   순회 역할에게는 남의 매물이라 404 가 맞음(expected_404) · 주인 seller 로 한 번 따로 열어 200 을 봄(맨 끝 owner_check)
 'mylisting': q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='seller@x.com' order by (l.status='PUBLISHED') desc, l.created_at desc limit 1") or q("select id from listings limit 1"),
 'mylisting_owner': q("select a.email from listings l join accounts a on a.id=l.owner_account_id where a.email='seller@x.com' order by (l.status='PUBLISHED') desc, l.created_at desc limit 1"),
}
ROUTES=json.load(open('site_routes.json'))
def fill(r):
    m={'/{gwan}/{id}':f"/money/{P['listing']}", '/{gwan}':'/money','/listings/{id}/edit':f"/listings/{P['mylisting']}/edit",
       '/request/{id}':f"/request/{P['request']}", '/deal/{id}/review':f"/deal/{P['deal']}/review",'/deal/{id}/contract':f"/deal/{P['deal']}/contract",
       '/deal/{id}/payment':f"/deal/{P['deal']}/payment",'/deal/{id}/confirm':f"/deal/{P['deal']}/confirm",'/chat/{id}':f"/chat/{P['listing']}",   # /chat/[id] 는 매물 id 를 받습니다
       '/my/contracts/{id}':f"/my/contracts/{P['contract']}", '/partner/services/{id}':f"/partner/services/{P['svc']}",
       '/terms/{code}':'/terms/SERVICE',
       '/community/{id}':f"/community/{P['post']}", '/health/c/{code}':'/health/c/ALL', '/health/i/{code}':'/health/i/VIT-D',
       '/health/p/{code}':f"/health/p/{P['hprod']}", '/health/w/{code}':'/health/w/IMMUNE',
       '/my/health/orders/{no}':f"/my/health/orders/{P['horder']}", '/my/health/orders/{no}/ship':f"/my/health/orders/{P['horder']}/ship",'/i/{token}':'/i/invalid-token-check','/report/{targetType}/{targetId}':f"/report/LISTING/{P['listing']}"}
    return m.get(r,r)
# v10.79 — 404 가 맞는 곳(오류로 세지 않고 expected_404 로 적음): 일부러 넣은 잘못된 초대 주소 · 남의 매물 고치기 화면
EXPECT_404={'/i/{token}': lambda role: True, '/listings/{id}/edit': lambda role: True}   # 순회 역할 중에는 그 매물 주인이 없음
ROLES={'guest':None,'person':'person@x.com','buyer':'buyer@x.com','intro':'intro@x.com','admin':'admin@x.com'}
if os.environ.get('CRAWL_ROLES'): ROLES={k:v for k,v in ROLES.items() if k in os.environ['CRAWL_ROLES'].split(',')}   # v10.73 — 역할 나눠 돌리기(CRAWL_ROLES=intro,admin)
out={'params':P,'pages':[], 'links':{}}
BAD_TXT=['Application error','This page could not be found','Internal Server Error','Unhandled Runtime Error','처리 중 오류가 발생했습니다']
def go(pg, url, **kw):   # v10.73 — 점검판 사용자 웹(next dev)이 메모리 한도로 스스로 다시 켜지는 동안은 기다렸다 다시(최대 2분)
    last = None
    for i in range(12):
        try: return pg.goto(url, **kw), i
        except Exception as ex:
            last = ex
            if 'ERR_EMPTY_RESPONSE' in str(ex) or 'ERR_SOCKET_NOT_CONNECTED' in str(ex) or 'ERR_CONNECTION' in str(ex): time.sleep(10); continue
            raise
    raise last
RESTARTS = []
with sync_playwright() as pw:
    br=pw.chromium.launch()
    for role,email in ROLES.items():
        ctx=br.new_context(); pg=ctx.new_page()
        if email:
            go(pg, BASE+'/login'); __import__('consent_ok').agree(email, 'sgb-dev-1234'); pg.fill('input[name=email]',email); pg.fill('input[name=password]','sgb-dev-1234')
            pg.click('form.auth button'); pg.wait_for_timeout(2500)
            ok=any(c['name'] for c in ctx.cookies() if 'at' in c['name'].lower() or 'token' in c['name'].lower())
            print(role,'login cookies',[c['name'] for c in ctx.cookies()],file=sys.stderr)
        for r in ROUTES:
            url=fill(r)
            errs=[]; apis=[]; cons=[]
            onerr=lambda e,errs=errs:errs.append(str(e)[:160]); pg.on('pageerror',onerr)
            def onresp(res,apis=apis):
                u=res.url
                if '/api/' in u and res.status>=400: apis.append(f"{res.status} {res.request.method} {urlparse(u).path}")
            pg.on('response',onresp)
            oncon=lambda m,cons=cons: cons.append(m.text[:160]) if m.type=='error' else None; pg.on('console',oncon)
            t0=time.time()
            try:
                resp,tries=go(pg,BASE+url,wait_until='networkidle',timeout=30000); st=resp.status if resp else 0
                if tries: RESTARTS.append((role,url,tries))
            except Exception as ex:
                st=-1; errs.append('goto:'+str(ex)[:120])
            dt=round(time.time()-t0,2)
            final=urlparse(pg.url).path
            def ev(js, d, pg=pg):   # v10.73 — 화면이 스스로 다른 주소로 넘어가는 중이면 자리 잡을 때까지 기다렸다 다시
                for _ in range(3):
                    try: return pg.evaluate(js)
                    except Exception:
                        try: pg.wait_for_load_state('networkidle', timeout=15000)
                        except Exception: pg.wait_for_timeout(1500)
                return d
            final=urlparse(pg.url).path
            body=ev("document.body?document.body.innerText:''", '')
            h1=ev("(()=>{const h=document.querySelector('h1');return h?h.innerText.slice(0,50):''})()", '')
            links=ev("""[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h&&h.startsWith('/')&&!h.startsWith('//'))""", [])
            buttons=ev("[...document.querySelectorAll('button,input[type=submit]')].filter(b=>b.offsetParent!==null).length", 0)
            forms=ev("document.querySelectorAll('form').length", 0)
            bad=[t for t in BAD_TXT if t in body]
            pg.remove_listener('response',onresp)
            rec={'role':role,'route':r,'url':url,'status':st,'final':final,'h1':h1,'len':len(body),'ms':dt,
                 'errors':errs,'console':cons[:5],'api_fail':apis,'bad_text':bad,'links':sorted(set(l.split('#')[0] for l in links)),'buttons':buttons,'forms':forms}
            if st==404 and r in EXPECT_404 and EXPECT_404[r](role): rec['expected_404']=True   # v10.79
            out['pages'].append(rec)
            flag='!!' if (st>=400 or errs or bad or apis) else '  '
            print(flag,role,url,st,'→'+final if final!=urlparse(url).path else '',h1[:30],apis[:3],bad,errs[:1],file=sys.stderr)
            pg.remove_listener('pageerror',onerr); pg.remove_listener('console',oncon)
        # 링크 상호 확인 — 이 역할로 본 모든 링크를 실제로 요청
        allLinks=sorted(set(l for p in out['pages'] if p['role']==role for l in p['links']))
        res={}
        for l in allLinks:
            try:
                r2=ctx.request.get(BASE+l,max_redirects=0,timeout=30000)
                res[l]=r2.status
            except Exception as ex: res[l]=str(ex)[:60]
        out['links'][role]=res
        ctx.close()
    # v10.79 — 주인이 자기 매물 고치기 화면을 열면 200 · 「소개하기 수정」
    if P.get('mylisting_owner'):
        ctx=br.new_context(); pg=ctx.new_page(); em=P['mylisting_owner']
        go(pg, BASE+'/login'); __import__('consent_ok').agree(em, 'sgb-dev-1234'); pg.fill('input[name=email]',em); pg.fill('input[name=password]','sgb-dev-1234')
        pg.click('form.auth button'); pg.wait_for_timeout(2500)
        url=fill('/listings/{id}/edit'); resp,_=go(pg, BASE+url, wait_until='domcontentloaded', timeout=60000); pg.wait_for_timeout(1500)
        h1=(pg.locator('h1').first.inner_text() if pg.locator('h1').count() else '')
        out['owner_check']={'owner':em,'url':url,'status':resp.status if resp else None,'h1':h1,'ok':bool(resp) and resp.status==200 and '소개하기 수정' in h1}
        print('owner_check',out['owner_check'],file=sys.stderr); ctx.close()
    br.close()
out['restart_waits']=RESTARTS
json.dump(out,open('site_crawl.json','w'),ensure_ascii=False,indent=1)
