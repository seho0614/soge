import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
OUT = os.environ.get("SGB_QA_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")
import json, subprocess, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
q=lambda s: subprocess.run(['psql',DB_URL,'-tAc',s],capture_output=True,text=True).stdout.strip()
L=q("select id from listings where status='PUBLISHED' order by created_at desc limit 1")
out=[]
def session(b,role):
    c=b.new_context(); pg=c.new_page()
    pg.goto('http://localhost:5174/login'); pg.fill('input[name=email]',f'{role}@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(1500)
    calls=[]
    pg.on('response',lambda r: calls.append(f"{r.status} {r.request.method} {urlparse(r.url).path} {r.text()[:140] if r.request.method!='GET' else ''}") if '/api/' in r.url and r.request.method!='GET' else None)
    return c,pg,calls
with sync_playwright() as p:
    b=p.chromium.launch()
    c,pg,calls=session(b,'person')
    pg.goto(f'http://localhost:5174/report/LISTING/{L}',wait_until='networkidle')
    pg.locator('button',has_text='연락처 · 외부 유도').click()
    ta=pg.locator('textarea'); 
    if ta.count(): ta.first.fill('본문에 전화번호를 적어 외부 연락을 유도합니다.')
    pg.locator('button',has_text='신고하기').click(); pg.wait_for_timeout(2000)
    out.append({'flow':'신고','calls':list(calls),'final':urlparse(pg.url).path}); c.close()
    c,pg,calls=session(b,'intro')
    pg.goto('http://localhost:5174/register',wait_until='networkidle')
    pg.locator('button',has_text='소개장터').first.click(); pg.wait_for_timeout(500)
    pg.locator('button',has_text='소개합니다').first.click(); pg.wait_for_timeout(1500)
    fields=pg.evaluate("[...document.querySelectorAll('main input, main textarea, main select')].filter(e=>e.offsetParent).map(e=>e.tagName+':'+(e.name||e.id||e.placeholder||'').slice(0,20)+':'+e.type)")
    btns=pg.evaluate("[...document.querySelectorAll('main button')].filter(b=>b.offsetParent).map(b=>b.innerText.trim().slice(0,16)+(b.disabled?'(off)':''))")
    out.append({'flow':'매물 등록 화면 구성','fields':fields,'buttons':btns})
    # fill — 이름으로 정확히 채웁니다
    pg.select_option('select[name=categoryId]', index=1)
    pg.fill('input[name=title]','E2E 화면 등록 — 사무실 인테리어 소개')
    pg.fill('textarea[name=body]','금천구 사무실 40평 인테리어 업체를 소개해 주시면 소개비를 드립니다. 시공 이력 확인 가능합니다.')
    pg.fill('input[name=desiredFee]','500000')
    pg.select_option('select[name=feeBearer]', index=1)
    calls.clear()
    sub=pg.locator('button',has_text='상품·서비스 등록')
    if sub.count(): sub.last.click(); pg.wait_for_timeout(2500)
    out.append({'flow':'매물 등록 제출','calls':list(calls),'final':urlparse(pg.url).path,'alert':pg.evaluate("[...document.querySelectorAll('[role=alert],.form-error,.err')].map(e=>e.innerText.slice(0,100)).join('|')")}); c.close()
    b.close()
for o in out: print(json.dumps(o,ensure_ascii=False)[:700])
json.dump(out,open(os.path.join(OUT,'forms2.json'),'w'),ensure_ascii=False,indent=1)
