"""v10.21 실제 웹 — 매물 상세(그림 1 형식) 점검. Playwright 로 실제 로그인 · 클릭. 결과: site_detail.json · 그림 site_detail_{1280,390}.png

  A. 구성(비로그인)   사진 자리 · 분류 · 제목 · 소개비 · 조회/관심/등록 · 등록자 줄(질문하기 · 전화하기) · 소개자 실적 · 상세 설명 · 공개 문의 · 소개자 후기 · 맨 아래 줄
  B. 진짜 값만        소개자 실적 = 서버 집계 · 후기 = 실제 후기(이름 · 연락처 가림) · 시안의 견본 숫자 · 이름이 없음 · 실적 · 후기가 없는 매물의 빈 표시
  C. 누적수익 공개     기본은 3칸 · 마이 > 내 정보에서 본인이 켜면 4번째 칸 · 끄면 다시 3칸
  D. 맨 아래 줄        관심 담기(로그인 전 → 로그인 · 로그인 뒤 담김/빼기 · DB 반영) · 질문 N · 공유하기 · 신고 · 1:1 문의 시작(자격에 따라)
  E. 세 관            /money · /mall(소개코드 공유 상자 유지) · /biz 가 같은 틀
  F. 그 밖            화면 오류 0(여러 번 열어도) · 390px 가로 스크롤 0 · 없는 번호 404 · 요청 목록/상세의 「등록」 값(G-128)

사용:  python3 site_detail.py      SITE=http://localhost:5174 · API=http://localhost:3000 · DB=postgresql://sgb:sgb@localhost:5432/sgb
새 계정만 만들어 씁니다(detail_fixture.py). 거래 3건은 끝에 지웁니다.
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright
import detail_fixture as F
from detail_fixture import call, q

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
BAD = ['Application error', 'Internal Server Error', 'Unhandled Runtime Error']
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], file=sys.stderr)

norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
# v10.31 — 매물 상세는 v10.29 부터 시안 scDtl 틀(gw-dt*)입니다(전 v10.21 「.ldp-*」). 키 이름은 그대로 두고 고르는 자리만 새 틀로.
PARTS = """()=>{const n=s=>document.querySelectorAll(s).length; const t=s=>{const e=document.querySelector(s); return e?(e.innerText||'').replace(/\\s+/g,' ').trim():''};
  const rv=document.querySelector('.gw-dgrid h4');
  return {hero:n('.gw-dtimg'), art:n('.gw-dtimg img'), title:t('.gw-dtt'), cat:t('.gw-dtcat'), fee:t('.gw-dtprice'), meta:t('.gw-dtmeta'),
          prof:t('.gw-dtprof'), profBtn:[...document.querySelectorAll('.gw-dtprof a.gw-bq, .gw-dtprof button.gw-bcall')].map(e=>(e.innerText||'').trim()),
          stats:[...document.querySelectorAll('.gw-stat > div')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()),
          desc:t('.gw-dsec .gw-body') || t('.gw-dsec'), spec:[...document.querySelectorAll('.gw-dsec > dl.gw-spec dt')].map(e=>(e.innerText||'').trim()), qna:n('#qna'),
          revHead:rv?(rv.innerText||'').replace(/\\s+/g,' ').trim():'', revs:[...document.querySelectorAll('.gw-revs .gw-rv2')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()), revEmpty:t('.gw-rvempty'),
          bar:[...document.querySelectorAll('.gw-abar > a, .gw-abar > button')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()),
          side:n('.detail-side'), ow:document.documentElement.scrollWidth - innerWidth, text:(document.querySelector('main')||document.body).innerText}}"""
BAR = '.gw-abar > a, .gw-abar > button'      # v10.31 맨 아래 줄(전 .ldp-bar > *)


def ui_login(ctx, email, pw=F.PW):
    pg = ctx.new_page()
    pg.goto(SITE + '/login', wait_until='networkidle')
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.locator('button', has_text='로그인').last.click()
    # v10.26 — 고정 2.5초 대신 로그인 쿠키가 생길 때까지 최대 15초(Docker 의 개발 모드 사용자 웹은 로그인 처리가 2.5초를 넘기도 함 — docker_site_detail D-6)
    ok = False
    for _ in range(30):
        pg.wait_for_timeout(500)
        if any(c['name'] == 'sgb_at' for c in ctx.cookies()): ok = True; break
    pg.wait_for_timeout(300)
    pg.close()
    return ok


def main(f, p):
    O, U, L = f['owner'], f['buyer'], f['listing']
    url = f'{SITE}/money/{L}'
    # 후기 2건(구매자 U 가 성사 확정 · 정산 완료 거래에) + 공개 문의 1건
    call('POST', f"/deals/{f['deals']['confirmed']}/reviews", U['tok'], {'rating': 5, 'body': '소통이 빠르고 조건에 맞는 곳을 소개받았습니다. 문의는 010-1234-5678 로 주세요.'})
    call('POST', f"/deals/{f['deals']['settled']}/reviews", U['tok'], {'rating': 4, 'body': '일정이 조금 밀렸지만 끝까지 챙겨 주셨습니다.'})
    st, _ = call('POST', f'/listings/{L}/questions', U['tok'], {'question': '이번 달 안에 착공이 가능한가요?'})

    b = p.chromium.launch()
    errs = []
    def ctx_new(w=1280, h=900):
        c = b.new_context(viewport={'width': w, 'height': h}, user_agent=UA, permissions=['clipboard-read', 'clipboard-write'])
        return c
    def page(c):
        pg = c.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'favicon' not in m.text else None)
        pg.on('dialog', lambda d: d.accept())
        return pg

    # ── A ── 비로그인
    g = ctx_new(); pg = page(g)
    r = pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(600); x = pg.evaluate(PARTS)
    rec('A-1 /money/{id} 200 · 사진 자리(분류 그림) · 분류 · 제목', r.status == 200 and x['hero'] == 1 and x['art'] >= 1 and x['title'] == f['title'] and bool(x['cat']), (r.status, x['hero'], x['art'], x['title'][:30]))
    rec('A-2 금액 자리에 소개비 500,000원(시안 표기 「50만원」)', '소개비' in x['fee'] and ('500,000원' in x['fee'] or '50만원' in x['fee']), x['fee'])
    rec('A-3 조회 N · 관심 N · 등록 시각이 한 줄에', bool(re.search(r'조회 \d+', x['meta'])) and bool(re.search(r'관심 \d+', x['meta'])) and bool(re.search(r'(방금|\d+시간 전|\d+일 전|\d{4}\.)', x['meta'])), x['meta'])
    rec('A-4 등록자 줄 — 상호 · 사업자 인증 · 가입 연월 · 「질문하기」 「전화하기」', O['company'] in x['prof'] and '사업자 인증' in x['prof'] and bool(re.search(r'가입일?\s*\d{4}\.\d{2}', x['prof'])) and [re.sub(r'^[^가-힣A-Za-z0-9]+', '', norm(t)) for t in x['profBtn']] == ['질문하기', '전화하기'], (x['prof'][:80], x['profBtn']))
    rec('A-5 상세 설명 — 본문 + 조건표(분류 · 지역 · 소개비 · 등록)', '인테리어 업체를 소개해 주시면' in x['desc'] and x['spec'][:1] == ['분류'] and '소개비' in x['spec'] and '등록' in x['spec'], (x['desc'][:40], x['spec']))
    rec('A-6 공개 문의 자리(#qna)가 있고 방금 넣은 문의가 보임', x['qna'] == 1 and '착공이 가능한가요' in x['text'], x['qna'])
    want = ['관심 담기', '질문', '공유하기', '신고']
    bar = [re.sub(r'^[^가-힣A-Za-z0-9]+', '', t) for t in x['bar']]
    rec('A-7 맨 아래 줄 — 「관심 담기 · 질문 N · 공유하기 · 신고 · (문의 버튼)」 다섯 개가 이 순서', len(bar) == 5 and bar[0] == '관심 담기' and re.fullmatch(r'질문 \d+', bar[1] or '') and bar[2] == '공유하기' and bar[3] == '신고', x['bar'])
    rec('A-8 비로그인의 문의 버튼은 「1:1 문의 시작 — 로그인 · 본인인증 후 문의할 수 있습니다」(자격은 서버가 판정 · v10.31 시안: 단추는 늘 주황)', len(bar) == 5 and '본인인증 후 문의' in bar[4], bar[-1:] )
    rec('A-9 옆 칸(전의 문의 상자)은 없어지고 한 틀로 — 화면 오류 글 없음', x['side'] == 0 and not any(t in x['text'] for t in BAD), x['side'])
    pg.screenshot(path=os.path.join(OUT, 'site_detail_1280.png'), full_page=True)

    # ── B ── 진짜 값만
    st = [norm(s) for s in x['stats']]
    rec('B-1 소개자 실적 = 서버 집계 — 총 소개 3건 · 성사(계약) 2건 · 성사율 66.7%', st[:3] == ['총 소개 3건', '성사(계약) 2건', '성사율 66.7%'], st)
    rec('B-2 누적수익 칸은 기본으로 「비공개」(시안 4칸 · v10.31) — 화면 어디에도 700,000 이 없음', len(st) == 4 and st[3] == '누적수익 비공개' and '700,000' not in x['text'], st)
    rec('B-3 소개자 후기 2건 · 평균 4.5 — 작성자는 「김○○」', len(x['revs']) == 2 and '4.5' in x['revHead'] and '2' in x['revHead'] and all('김○○' in v for v in x['revs']) and U['name'] not in x['text'], (x['revHead'], [v[:30] for v in x['revs']]))
    rec('B-4 후기 본문의 전화번호는 가려져 있음', ('[연락처]' in ' '.join(x['revs']) or '***-****-****' in ' '.join(x['revs'])) and '010-1234-5678' not in x['text'], [v[:60] for v in x['revs']])
    rec('B-5 시안의 견본 값이 없음 — 홍길동 · 128건 · 15,680,000 · 신용 86점', not any(t in x['text'] for t in ['홍길동', '128건', '15,680,000', '신용 86점', '김사장']), [t for t in ['홍길동', '128건', '15,680,000', '신용 86점'] if t in x['text']])
    other = q(f"select l.id from listings l where l.status='PUBLISHED' and l.gwan_code='MNY' and l.owner_account_id <> '{O['id']}' and not exists (select 1 from deals d where d.introducer_account_id = l.owner_account_id) and not exists (select 1 from deal_reviews r where r.target_id = l.owner_account_id) limit 1")
    pg.goto(f'{SITE}/money/{other}', wait_until='networkidle'); pg.wait_for_timeout(400); y = pg.evaluate(PARTS); st2 = [norm(s) for s in y['stats']]
    rec('B-6 실적 · 후기가 없는 매물 — 총 소개 0건 · 성사(계약) 0건 · 성사율 — · 「아직 후기가 없습니다」', st2[:3] == ['총 소개 0건', '성사(계약) 0건', '성사율 —'] and '아직 후기가 없습니다' in y['revEmpty'] and len(y['revs']) == 0, (st2, y['revEmpty']))

    # ── D ── 맨 아래 줄 (비로그인)
    pg.goto(url, wait_until='networkidle'); pg.locator(BAR).nth(0).click(); pg.wait_for_timeout(1500)
    rec('D-1 비로그인 「관심 담기」 → 로그인 화면으로(돌아올 주소 포함)', '/login' in pg.url and 'next=' in pg.url, pg.url)
    pg.goto(url, wait_until='networkidle'); pg.locator(BAR).nth(1).click(); pg.wait_for_timeout(700)
    rec('D-2 「질문 N」 → 공개 문의 자리로 내려감', pg.evaluate("(()=>{const r=document.getElementById('qna').getBoundingClientRect(); return r.top>=-10 && r.top<innerHeight})()") and '/money/' in pg.url, pg.url)
    pg.locator(BAR).nth(2).click(); pg.wait_for_timeout(500)
    rec('D-3 「공유하기」 → 주소 복사 안내가 뜸', '복사' in (pg.locator('.gw-barmsg').inner_text() if pg.locator('.gw-barmsg').count() else ''), pg.locator('.gw-barmsg').inner_text() if pg.locator('.gw-barmsg').count() else '(안내 없음)')
    href = pg.locator(BAR).nth(3).get_attribute('href')
    rec('D-4 「신고」는 이 매물의 신고 화면으로 가는 링크', href == f'/report/listing/{L}', href)
    pg.locator('.gw-dtprof .gw-bcall').click(); pg.wait_for_timeout(300)
    rec('D-5 「전화하기」는 창을 띄우지 않고 그 자리에 「준비 중」 안내', '준비 중' in (pg.locator('.gw-profmsg').inner_text() if pg.locator('.gw-profmsg').count() else ''), '')
    # 로그인으로 보낸 뒤 — 로그인하면 보던 매물로 돌아옵니다
    pg.goto(url, wait_until='networkidle'); pg.locator(BAR).nth(0).click(); pg.wait_for_timeout(1500)
    if '/login' in pg.url:
        __import__('consent_ok').agree(U['email'], F.PW); pg.fill('input[name=email]', U['email']); pg.fill('input[name=password]', F.PW); pg.locator('button', has_text='로그인').last.click(); pg.wait_for_timeout(3000)
    rec('D-1b 그 로그인 화면에서 로그인하면 보던 매물로 돌아옴', pg.url.rstrip('/').endswith(f'/money/{L}'), pg.url)
    g.close()
    gx = ctx_new(); px = page(gx)
    px.goto(SITE + '/login?next=' + 'https%3A%2F%2Fevil.example%2Fx', wait_until='networkidle')
    __import__('consent_ok').agree(U['email'], F.PW); px.fill('input[name=email]', U['email']); px.fill('input[name=password]', F.PW); px.locator('button', has_text='로그인').last.click(); px.wait_for_timeout(3000)
    u1 = px.url
    gx.close(); gx = ctx_new(); px = page(gx)
    px.goto(SITE + '/login?next=' + '%2F%2Fevil.example%2Fx', wait_until='networkidle')
    __import__('consent_ok').agree(U['email'], F.PW); px.fill('input[name=email]', U['email']); px.fill('input[name=password]', F.PW); px.locator('button', has_text='로그인').last.click(); px.wait_for_timeout(3000)
    u2 = px.url; gx.close()
    rec('D-1c 돌아올 주소가 바깥 사이트면 따르지 않음(https://… · //… → 우리 사이트 안에 머묾)', u1.startswith(SITE) and u2.startswith(SITE) and 'evil.example' not in u1 and 'evil.example' not in u2, (u1, u2))

    gx = ctx_new(); px = page(gx)
    px.goto(SITE + '/login', wait_until='networkidle')
    __import__('consent_ok').agree(U['email'], F.PW); px.fill('input[name=email]', U['email']); px.fill('input[name=password]', F.PW); px.locator('button', has_text='로그인').last.click(); px.wait_for_timeout(3000)
    land = q("select value from site_settings where key='site.landing_after_login'")
    st_land = px.evaluate("fetch(location.href).then(r=>r.status)")
    want_path = {'MNY': '/money', 'MAL': '/mall', 'BIZ': '/biz', 'HLT': '/health'}.get(land, '/')
    rec(f'D-1d 그냥 로그인하면 운영이 정한 도착 화면(설정 {land or "없음"} → {want_path})이 열림 — 없는 주소(404)로 가지 않음(G-135)', px.url.replace(SITE, '').rstrip('/') == want_path.rstrip('/') and st_land == 200 and '찾을 수 없' not in px.inner_text('body')[:600], (px.url, st_land))
    errs[:] = [e for e in errs if '404' not in e]      # 고치기 전 판에서는 여기서 404 가 납니다 — 뒤의 오류 수 점검과 섞이지 않게
    gx.close()

    # ── D ── 로그인한 구매자
    cu = ctx_new(); ok = ui_login(cu, U['email']); pu = page(cu)
    pu.goto(url, wait_until='networkidle'); pu.wait_for_timeout(500); z = pu.evaluate(PARTS); bz = [re.sub(r'^[^가-힣A-Za-z0-9]+', '', t) for t in z['bar']]
    rec('D-6 사업자 인증을 마친 구매자 — 문의 버튼이 「1:1 문의 시작」', ok and len(bz) == 5 and bz[4].startswith('1:1 문의 시작'), (ok, bz))
    n0 = int(re.search(r'관심 (\d+)', z['meta']).group(1)) if re.search(r'관심 (\d+)', z['meta']) else -1
    pu.locator(BAR).nth(0).click(); pu.wait_for_timeout(1200)
    lab = re.sub(r'^[^가-힣A-Za-z0-9]+', '', pu.locator(BAR).nth(0).inner_text().strip()); fav = q(f"select count(*) from favorites where account_id='{U['id']}' and target_id='{L}'")
    m1 = pu.evaluate("(()=>{const e=document.querySelector('.gw-dtmeta'); return e?e.innerText:''})()"); n1 = int(re.search(r'관심 (\d+)', m1).group(1)) if re.search(r'관심 (\d+)', m1) else -1
    rec('D-7 「관심 담기」 → 「관심 담김」 · DB 에 저장 · 관심 수 +1', lab == '관심 담김' and fav == '1' and n1 == n0 + 1, (lab, fav, n0, n1))
    pu.reload(wait_until='networkidle'); pu.wait_for_timeout(400)
    lab2 = re.sub(r'^[^가-힣A-Za-z0-9]+', '', pu.locator(BAR).nth(0).inner_text().strip())
    rec('D-8 새로 열어도 「관심 담김」으로 남아 있음', lab2 == '관심 담김', lab2)
    pu.locator(BAR).nth(0).click(); pu.wait_for_timeout(1200)
    lab3 = re.sub(r'^[^가-힣A-Za-z0-9]+', '', pu.locator(BAR).nth(0).inner_text().strip())
    rec('D-9 다시 누르면 「관심 담기」 · DB 에서 빠짐', lab3 == '관심 담기' and q(f"select count(*) from favorites where account_id='{U['id']}' and target_id='{L}'") == '0', lab3)
    pu.locator(BAR).nth(4).click()
    try: pu.wait_for_url(f'**/chat/{L}', timeout=30000)      # 개발 방식으로 띄운 사용자 웹(개발 Docker)은 처음 여는 쪽을 그때 빌드해 몇 초 걸립니다
    except Exception: pass
    rec('D-10 「1:1 문의 시작」 → 이 매물의 문의방(/chat/{id})', pu.url.rstrip('/').endswith(f'/chat/{L}'), pu.url)
    pu.goto(f'{SITE}/report/listing/{L}', wait_until='networkidle')
    rec('D-11 신고 화면이 열림(로그인 상태)', '신고하기' in pu.inner_text('main') and not any(t in pu.inner_text('body') for t in BAD), pu.url)
    cu.close()

    # ── C ── 누적수익 공개 — 등록자 본인이 마이 > 내 정보에서
    co = ctx_new(); ok = ui_login(co, O['email']); po = page(co)
    po.goto(url, wait_until='networkidle'); po.wait_for_timeout(400); w = po.evaluate(PARTS); bw = [re.sub(r'^[^가-힣A-Za-z0-9]+', '', t) for t in w['bar']]
    rec('C-1 등록자 본인이 보면 문의 버튼은 「내가 등록한 매물입니다」(눌리지 않음)', ok and len(bw) == 5 and '내가 등록한 매물' in bw[4] and po.locator(BAR).nth(4).is_disabled(), bw[-1:])
    po.goto(f'{SITE}/my/account', wait_until='networkidle'); po.wait_for_timeout(400)
    box = po.locator('input[name=earningsPublic]')
    rec('C-2 마이 > 내 정보에 「누적수익 공개」 선택 칸 — 기본은 꺼짐 · 설명 글', box.count() == 1 and not box.is_checked() and '누적수익' in po.inner_text('main') and '소개자 실적' in po.inner_text('main'), box.count())
    if box.count():
        box.check(); po.locator('form:has(input[name=earningsPublic]) button').last.click(); po.wait_for_timeout(1500)
    rec('C-3 켜고 저장 → 저장 안내 · DB 반영 · 본인인증은 그대로', q(f"select earnings_public::text||'|'||(identity_verified_at is not null)::text from accounts where id='{O['id']}'") == 'true|true' and '수정했습니다' in po.inner_text('main'), q(f"select earnings_public from accounts where id='{O['id']}'"))
    gg = ctx_new(); pgg = page(gg); pgg.goto(url, wait_until='networkidle'); pgg.wait_for_timeout(500); v = pgg.evaluate(PARTS); sv = [norm(s) for s in v['stats']]
    rec('C-4 켠 뒤 — 비로그인이 봐도 4번째 칸 「누적수익 700,000원」', len(sv) == 4 and sv[3] == '누적수익 700,000원', sv)
    po.goto(f'{SITE}/my/account', wait_until='networkidle'); po.wait_for_timeout(300)
    box = po.locator('input[name=earningsPublic]')
    rec('C-5 내 정보를 다시 열면 켜진 채로 보임', box.count() == 1 and box.is_checked(), '')
    if box.count():
        box.uncheck(); po.locator('form:has(input[name=earningsPublic]) button').last.click(); po.wait_for_timeout(1500)
    pgg.goto(url, wait_until='networkidle'); pgg.wait_for_timeout(500); v = pgg.evaluate(PARTS); sv = [norm(s) for s in v['stats']]
    rec('C-6 끄면 다시 「비공개」 — 700,000 이 화면에 없음', len(sv) == 4 and sv[3] == '누적수익 비공개' and '700,000' not in v['text'] and q(f"select earnings_public from accounts where id='{O['id']}'") == 'f', sv)
    co.close()

    # ── E ── 세 관
    for path, gw, need in (('mall', 'MAL', True), ('biz', 'BIZ', False)):
        lid = q(f"select id from listings where status='PUBLISHED' and gwan_code='{gw}' order by published_at desc nulls last limit 1")
        if not lid:
            rec(f'E /{path} — 게시된 매물이 없어 건너뜀', True, ''); R[-1]['skip'] = True; continue
        pgg.goto(f'{SITE}/{path}/{lid}', wait_until='networkidle'); pgg.wait_for_timeout(500); e = pgg.evaluate(PARTS)
        be = [re.sub(r'^[^가-힣A-Za-z0-9]+', '', t) for t in e['bar']]
        okf = e['hero'] == 1 and len(e['stats']) >= 3 and e['qna'] == 1 and len(be) == 5 and be[0] == '관심 담기' and be[3] == '신고' and bool(e['title'])
        ref = pgg.locator('.refshare, .ref-share, [class*=refshare], [class*=ref-]').count() > 0 or '소개코드' in e['text']
        rec(f'E /{path}/{{id}} — 같은 틀(사진 자리 · 실적 · 공개 문의 · 맨 아래 줄 5개)' + (' · 「소개코드 공유」 상자 유지' if need else ' · 소개코드 상자 없음'), okf and (ref if need else True), (e['hero'], len(e['stats']), be, ref))

    # ── F ── 그 밖
    n_err0 = len(errs)
    for i in range(8):
        pgg.goto(url, wait_until='networkidle'); pgg.wait_for_timeout(250)
    rec('F-1 상세를 8번 새로 열어도 화면 오류(콘솔 · 수화) 0', len(errs) == n_err0 == 0 or len(errs) == 0, errs[:3])
    gg.close()
    m = ctx_new(390, 800); pm = page(m); pm.goto(url, wait_until='networkidle'); pm.wait_for_timeout(500); mm = pm.evaluate(PARTS)
    rec('F-2 390px — 가로 스크롤 0 · 맨 아래 줄 5개가 다 보임', mm['ow'] <= 1 and len(mm['bar']) == 5 and pm.locator(BAR).nth(4).is_visible(), (mm['ow'], mm['bar']))
    pm.screenshot(path=os.path.join(OUT, 'site_detail_390.png'), full_page=True)
    # 사용자 웹은 공개 응답을 10초 캐시합니다 — 서버를 막 올린 직후에는 앞 판의 응답이 한 번 나올 수 있어, 비어 있으면 잠깐 뒤 한 번 더 엽니다
    whens = []
    for _ in range(2):
        pm.goto(f'{SITE}/request', wait_until='networkidle'); pm.wait_for_timeout(300)
        # v10.31 (w1 시안 reqCard) — 요청 카드는 등록 시각 대신 마감까지 남은 날(D-n)을 보입니다(요청은 등록 + 30일 마감 · D044)
        whens = pm.evaluate("()=>[...document.querySelectorAll('.when, .w1-rqc')].map(e=>(e.classList.contains('w1-rqc') ? ((e.querySelector('.w1-dday')||{}).innerText||'') : (e.innerText||'')).trim())")
        if whens and all(whens): break
        pm.wait_for_timeout(1500)
    rec(f'F-4 요청 목록 {len(whens)}건마다 때 표시(마감 D-n · 빈 칸 0 · G-128)', len(whens) >= 1 and all(re.search(r'(방금|\d+시간 전|\d+일 전|\d{4}\.|D-\d+)', t) for t in whens), whens[:5])
    rid = q("select id from requests where status='PUBLISHED' order by created_at desc limit 1")
    dd = None
    for _ in range(2):
        pm.goto(f'{SITE}/request/{rid}', wait_until='networkidle'); pm.wait_for_timeout(300)
        dd = pm.evaluate("()=>{const dt=[...document.querySelectorAll('dt')].find(e=>e.innerText.trim()==='등록'); if (dt&&dt.nextElementSibling) return dt.nextElementSibling.innerText.trim(); const p=[...document.querySelectorAll('.w1-nt3')].find(e=>/^등록 /.test(e.innerText.trim())); return p?p.innerText.trim().slice(3):null}")   # v10.31 — 「등록 3일 전」 한 줄
        if dd: break
        pm.wait_for_timeout(1500)
    rec('F-5 요청 상세의 「등록」 값이 보임', bool(dd) and bool(re.search(r'(방금|\d+시간 전|\d+일 전|\d{4}\.)', dd)), dd)
    rec('F-6 시험 내내 화면 오류 0', not errs, errs[:3])
    r1 = pm.goto(f'{SITE}/money/not-a-uuid', wait_until='networkidle'); r2 = pm.goto(f'{SITE}/money/00000000-0000-4000-8000-000000000000', wait_until='networkidle')
    rec('F-3 형식이 틀린 번호 · 없는 번호는 404 (500 아님)', r1.status == 404 and r2.status == 404, (r1.status, r2.status))
    m.close()
    b.close()


if __name__ == '__main__':
    f = None
    try:
        f = F.make()
        with sync_playwright() as p: main(f, p)
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    finally:
        try: rec('Z-1 시험 자료(거래 3건)를 지웠고 거래 표의 규칙이 모두 켜져 있음', F.cleanup(f), '')
        except Exception as ex: rec('Z-1 시험 자료 지우기', False, repr(ex)[:200])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'site_detail.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
