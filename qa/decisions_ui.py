"""결정 5건 화면 검증 (BO 지급 데스크 · 사용자 웹)."""
import json, subprocess, sys, uuid, urllib.request
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__))); sys.path.append(__import__('os').environ.get('QA', '/home/claude/qa'))   # v10.31 (w6 사본) — consent_ok 등은 원래 qa 폴더
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
DB='postgresql://sgb:sgb@localhost:5432/sgb'
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
sh=lambda s: subprocess.run(['psql',DB,'-qc',s],capture_output=True,text=True)
R=[]
def rec(step,ok,detail=''): R.append({'step':step,'ok':bool(ok),'detail':str(detail)[:200]}); print('ok  ' if ok else 'FAIL',step,str(detail)[:150],file=sys.stderr)
pid=q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
sh(f"UPDATE partner_settlement_accounts SET verified_at=now() WHERE partner_id='{pid}'")
sh(f"WITH x AS (SELECT (random()*900)::int AS r) INSERT INTO partner_settlements(partner_id,track,period_from,period_to,gross_amount,withholding,net_amount) SELECT '{pid}','AFFILIATE','2028-01-01'::date+r,'2028-02-01'::date+r,50000,1650,48350 FROM x")
def bo_login(pg,email,pw):
    pg.goto('http://127.0.0.1:5173'); pg.wait_for_timeout(500)
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]',email); pg.fill('input[name=password]',pw); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
with sync_playwright() as p:
    b=p.chromium.launch()
    # Q1 운영 확정
    c=b.new_context(); pg=c.new_page(); pg.on('dialog',lambda d:d.accept())
    bo_login(pg,'ops@t.local','sgb-test-1234')
    tabs=_bo_tab_names(pg)   # v10.29
    rec('Q1-UI-1 운영(ADMIN)에 지급 탭', '지급' in tabs, tabs)
    _bo_tab(pg, '지급'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    n_draft=pg.locator('button',has_text='확정').count()
    rec('Q1-UI-2 운영 화면에 확정 버튼 · 지급 버튼 없음', n_draft>0 and pg.locator('button',has_text='지급 기록').count()==0, f'확정 {n_draft}')
    pg.locator('button',has_text='확정').first.click(); pg.wait_for_timeout(1500)
    rec('Q1-UI-3 운영 확정 후 안내', '확정했습니다' in pg.evaluate("document.querySelector('.bo-main').innerText"), '')
    c.close()
    # Q1 지급 담당 지급
    c=b.new_context(); pg=c.new_page(); pg.on('dialog',lambda d:d.accept())
    bo_login(pg,'payout@t.local','sgb-test-1234')
    tabs=_bo_tab_names(pg)   # v10.29
    rec('Q1-UI-4 지급 담당 탭 = 대시보드 · 지급 · 퍼블리셔 지급', tabs==['대시보드','지급','퍼블리셔 지급'], tabs)   # v10.31 (w6) — 시안 SB-ADS-PAY-010 퍼블리셔 지급(PAYOUT)
    _bo_tab(pg, '지급'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    errs=pg.evaluate("[...document.querySelectorAll('.bo-main [role=alert], .bo-main .error')].map(e=>e.innerText)")
    rec('Q1-UI-5 지급 담당 화면 오류 없음', not errs, errs)
    ready=pg.locator('button:not([disabled])',has_text='지급 기록')
    rec('Q1-UI-6 지급 기록 버튼(바로 보낼 수 있는 건)', ready.count()>0, ready.count())
    if ready.count():
        row=ready.first.locator('xpath=ancestor::div[contains(@class,"card")]')
        row.locator('input').fill('KB-UI-'+uuid.uuid4().hex[:6]); ready.first.click(); pg.wait_for_timeout(1500)
        txt=pg.evaluate("document.querySelector('.bo-main').innerText")
        rec('Q1-UI-7 지급 기록 → 최근 지급에 표시', '지급을 기록했습니다' in txt and 'KB-UI-' in txt, '')
    rec('Q1-UI-8 지급 담당 화면에 확정 버튼 없음', pg.locator('button',has_text='확정').count()==0, '')
    c.close()
    # Q5 운영 계정 사용자 웹
    c=b.new_context(); pg=c.new_page()
    pg.goto('http://localhost:5174/login'); __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]','admin@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2000)
    pg.goto('http://localhost:5174/my',wait_until='networkidle')
    rec('Q5-UI-1 운영 계정으로 나의공간 진입 (전: 로그인으로 튕김)', urlparse(pg.url).path=='/my', pg.url)
    pg.goto('http://localhost:5174/request/new',wait_until='networkidle')
    rec('Q5-UI-2 운영 계정으로 요청 등록 화면', urlparse(pg.url).path=='/request/new', pg.url)
    c.close()
    # Q2·Q3 개인 회원이 화면에서 확인
    # 20261001 — 시험 거래를 매번 새로 만듭니다. 전에는 '구매자의 최근 문의 거래' 를 골라
    #   다른 시험(e2e)이 만든 거래(판매자 ≠ intro)가 잡히면 판매자 확인이 헛돌았습니다.
    def api(m,path,tok=None,body=None):
        h={'content-type':'application/json','Idempotency-Key':uuid.uuid4().hex}
        if tok: h['authorization']='Bearer '+tok
        r=urllib.request.urlopen(urllib.request.Request('http://localhost:3000/api/v1'+path,method=m,data=json.dumps(body or {}).encode(),headers=h))
        return json.loads(r.read())
    BT=api('POST','/auth/login',body={'email':'buyer@x.com','password':'sgb-dev-1234'})['accessToken']
    ST=api('POST','/auth/login',body={'email':'intro@x.com','password':'sgb-dev-1234'})['accessToken']
    lid=q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='PUBLISHED' limit 1")
    cid=api('POST','/conversations',BT,{'targetType':'LISTING','targetId':lid,'message':'화면 검증 문의 '+uuid.uuid4().hex[:5]}).get('conversationId')
    did=api('POST',f'/conversations/{cid}/deal',ST).get('dealId')
    if not did:
        rec('Q2-UI-0 준비된 거래 없음',False,'')
    else:
        c=b.new_context(); pg=c.new_page(); pg.on('dialog',lambda d:d.accept())
        pg.goto('http://localhost:5174/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]','buyer@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2000)
        pg.goto(f'http://localhost:5174/deal/{did}/confirm',wait_until='networkidle')
        pg.locator('button',has_text='거래 성사 확인').click(); pg.wait_for_timeout(2000)
        t=pg.evaluate("document.querySelector('main, body').innerText")
        # v10.31 (w1 시안 scDealConfirm) — 누르면 화면을 새로 그려 「확인 1 / 2 · 대기 중」 · 내 줄 「확인 완료」로 바뀝니다(전: 안내 글 한 줄)
        rec('Q2-UI-1 개인 회원 화면에서 확인', '상대방 확인을 기다립니다' in t or '확정되었습니다' in t or ('확인 1 / 2' in t and '확인 완료' in t and '거래 성사 확인' not in t), t[t.find('확인 '):][:160])
        c.close()
        c=b.new_context(); pg=c.new_page(); pg.on('dialog',lambda d:d.accept())
        pg.goto('http://localhost:5174/login'); __import__('consent_ok').agree('intro@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]','intro@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2000)
        pg.goto(f'http://localhost:5174/deal/{did}/confirm',wait_until='networkidle')
        pg.locator('button',has_text='거래 성사 확인').click(); pg.wait_for_timeout(2000)
        t=pg.evaluate("document.querySelector('main, body').innerText")
        rec('Q3-UI-1 판매자 확인 → 확정 안내', '확정되었습니다' in t or ('확인 2 / 2' in t and '양측 확인이 끝났습니다' in t), did+' | '+t[t.find('확인 '):][:300])   # v10.31 화면 글
        rec('Q3-UI-2 DB 상태 CONFIRMED', q(f"select status from deals where id='{did}'")=='CONFIRMED', q(f"select status from deals where id='{did}'"))
        c.close()
    b.close()
json.dump(R,open('decisions_ui.json','w'),ensure_ascii=False,indent=1)
print('통과',sum(r['ok'] for r in R),'/',len(R))
