"""D001 화면 검증 — 파트너 소개링크 공유 주소 · /r/{code} 이동 · 정산 계좌 1원 인증 · BO 지급 창구.

사용:  SITE=http://localhost:5191 BO=http://localhost:5192 python3 srv_aff_ui.py
       (기본 SITE=http://localhost:5174, BO=http://127.0.0.1:5173)
결과:  srv_aff_ui.json.  원복: 시험 정산서 삭제 · intro 정산 계좌는 화면에서 다시 인증해 둡니다.
"""
import json, os, sys, uuid, subprocess
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
BO = os.environ.get('BO', 'http://127.0.0.1:5173').rstrip('/')
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
sh = lambda s: subprocess.run(['psql', DB, '-qc', s], capture_output=True, text=True)
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

PID = q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
SID = str(uuid.uuid4())
sh(f"insert into partner_settlements(id,partner_id,track,period_from,period_to,gross_amount,withholding,net_amount) values ('{SID}','{PID}','AFFILIATE','2031-01-01'::date+(random()*200)::int,'2031-12-31',8036,265,7771)")
sh(f"update partner_settlements set state='CONFIRMED', confirmed_by=(select id from accounts where email='ops@t.local') where id='{SID}'")

def site_login(pg, email):
    pg.goto(SITE + '/login'); __import__('consent_ok').agree(email, 'sgb-dev-1234'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'sgb-dev-1234')
    pg.click('form.auth button'); pg.wait_for_timeout(2000)

def bo_payout_text(b):
    c = b.new_context(); pg = c.new_page()
    pg.goto(BO); pg.wait_for_timeout(500)
    __import__('consent_ok').agree('payout@t.local', 'sgb-test-1234'); pg.fill('input[name=email]', 'payout@t.local'); pg.fill('input[name=password]', 'sgb-test-1234')
    pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
    _bo_tab(pg, '지급'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    card = pg.locator('.card.row', has_text='7,771')
    t = card.first.inner_text() if card.count() else ''
    btn = card.first.locator('button', has_text='지급 기록').is_enabled() if card.count() else None
    c.close()
    return t, btn

with sync_playwright() as p:
    b = p.chromium.launch()
    # ── 1. 소개링크 화면 — 공유 주소 · 복사 · 클릭 수
    c = b.new_context(user_agent=UA); c.grant_permissions(['clipboard-read', 'clipboard-write'], origin=SITE)
    pg = c.new_page(); site_login(pg, 'intro@x.com')
    pg.goto(SITE + '/partners/links', wait_until='networkidle')
    row = pg.locator('tr', has=pg.locator('[data-testid=share-url]')).filter(has_text='사용 중').first
    url = row.locator('[data-testid=share-url]').inner_text().strip()
    code = row.get_attribute('data-link-code')
    rec('UI-1 소개링크에 공유 전체 주소', url == f'{SITE}/r/{code}', url)
    row.locator('button', has_text='주소 복사').click(); pg.wait_for_timeout(400)
    clip = pg.evaluate('navigator.clipboard.readText()')
    rec('UI-2 「주소 복사」 → 클립보드에 공유 주소', clip == url and '복사했습니다' in row.inner_text(), clip)
    before = int(q(f"select coalesce(sum(clicks),0) from partner_link_stats s join partner_links l on l.id=s.link_id where l.code='{code}'") or 0)
    # ── 2. 비로그인 방문자가 공유 주소를 누름 → 302 → 착지
    v = b.new_context(user_agent=UA); vp = v.new_page()
    land = q(f"select coalesce(l.landing_url,p.landing_url) from partner_links l join affiliate_products p on p.id=l.product_id where l.code='{code}'")
    # 착지(외부 도메인)는 이 시험 환경에서 나갈 수 없어, 같은 브라우저 문맥(쿠키 공유)의 요청으로 302 를 봅니다
    resp = v.request.get(url, max_redirects=0)
    rec('UI-3 공유 주소 → 302 → 상품 착지 주소', resp.status == 302 and resp.headers.get('location', '').rstrip('/') == land.rstrip('/'), (resp.status, resp.headers.get('location'), land))
    cookie = [x for x in v.cookies() if x['name'] == 'sgb_visitor']
    rec('UI-4 방문자 쿠키 발급(중복 제거용)', len(cookie) == 1, cookie and cookie[0]['value'])
    v.request.get(url, max_redirects=0); v.request.get(url, max_redirects=0)
    after = int(q(f"select coalesce(sum(clicks),0) from partner_link_stats s join partner_links l on l.id=s.link_id where l.code='{code}'") or 0)
    rec('UI-5 같은 방문자 세 번 → 클릭 +1', after == before + 1, f'{before}->{after}')
    r404 = vp.goto(SITE + '/r/NOPE-0000000')
    rec('UI-6 없는 링크 → 친절한 404', r404.status == 404 and '링크를 열 수 없습니다' in vp.inner_text('body') and vp.locator('a[href="/"]').count() == 1, r404.status)
    off = q("select l.code from partner_links l join affiliate_products p on p.id=l.product_id where p.status<>'ON_SALE' limit 1")
    if off:
        r = vp.goto(SITE + '/r/' + off)
        rec('UI-7 판매 중 아닌 상품 링크 → 404 · 사유', r.status == 404 and '판매' in vp.inner_text('body'), r.status)
    v.close()
    pg.goto(SITE + '/partners/links', wait_until='networkidle')
    cell = pg.locator(f'tr[data-link-code="{code}"] td.num').nth(1).inner_text()
    rec('UI-8 소개링크 화면 클릭 수 반영 (오늘 / 누적)', cell.split('/')[-1].strip().replace(',', '') == str(after), cell)

    # ── 3. 정산 계좌 변경 → 인증 풀림 → 1원 인증 두 단계
    pg.goto(SITE + '/partners/settlements', wait_until='networkidle')
    # v10.29(시험 자료) — 계좌가 아직 없는 DB(새로 만든 DB)에서는 화면이 처음부터 등록 칸을 펼쳐 「계좌 변경」 단추가 없습니다. 있을 때만 누릅니다
    if pg.locator('button', has_text='계좌 변경').count(): pg.locator('button', has_text='계좌 변경').click()
    pg.select_option('select[name=bankCode]', '004')
    pg.fill('input[name=accountNo]', '123-456-789012'); pg.fill('input[name=holderName]', '김소개')
    pg.locator('button', has_text='계좌 저장').click(); pg.wait_for_timeout(2500)
    st = pg.locator('[data-testid=account-state]').inner_text()
    rec('UI-9 계좌 저장 → 상태 「1원 인증 전」 · 인증 칸 표시', '1원 인증 전' in st and pg.locator('[data-testid=account-verify]').count() == 1, st)
    t, btn = bo_payout_text(b)
    rec('UI-10 BO 지급 창구 — 「계좌 1원 인증 전」 · 지급 버튼 꺼짐', '계좌 1원 인증 전' in t and btn is False, (t[:120], btn))
    pg.locator('button', has_text='1원 받기').click(); pg.wait_for_timeout(1500)
    box = pg.locator('[data-testid=account-verify]').inner_text()
    rec('UI-11 「1원 받기」 → 스텁 안내·코드·유효시간', 'SGB01' in box and '까지' in box and pg.locator('input[name=code]').count() == 1, box[-160:])
    pg.fill('input[name=code]', 'WRONG1'); pg.locator('button', has_text='인증하기').click(); pg.wait_for_timeout(1200)
    box = pg.locator('[data-testid=account-verify]').inner_text()
    rec('UI-12 틀린 코드 → 남은 횟수 안내', '4회 남았습니다' in box, box[-120:])
    pg.fill('input[name=code]', 'sgb01'); pg.locator('button', has_text='인증하기').click(); pg.wait_for_timeout(2500)
    st = pg.locator('[data-testid=account-state]').inner_text()
    rec('UI-13 맞는 코드 → 「인증 완료」 · 인증 칸 사라짐', '인증 완료' in st and pg.locator('[data-testid=account-verify]').count() == 0, st)
    t, btn = bo_payout_text(b)
    rec('UI-14 BO 지급 창구 — blocker 풀림 · 지급 버튼 켜짐', '1원 인증 전' not in t and btn is True, (t[:120], btn))
    c.close(); b.close()

sh(f"delete from partner_settlements where id='{SID}'")
rec('Z-1 원복 — intro 계좌 인증 상태 · 시험 정산서 삭제',
    q(f"select (verified_at is not null)::text from partner_settlement_accounts where partner_id='{PID}'") == 'true'
    and q(f"select count(*) from partner_settlements where id='{SID}'") == '0', '')
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_aff_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
