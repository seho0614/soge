"""10/2 v10.14 — 「이건 어때?」 투표 · 사회관계망 주소 화면 검증 (사용자 웹 5174 · 운영 화면 5173 · 실제 브라우저).  결과: srv_poll_ui.json

  A. 메인 카드(비로그인)   고르기 → 투표 → 결과 · 새로고침 뒤에도 유지 · 참여 수 = DB 의 실제 표 수 · 방문자 쿠키 · 헤더 위조 차단
  B. 다른 방문자 · 회원    기기마다 1표 · 회원은 계정으로 따로 1표
  C. 소개광장 투표 목록    /community/polls — 진행 · 마감 · 탭
  D. 운영 「이건 어때? 투표」 만들기 → 열기 → 마감 → 감추기(사유) · 비로그인 끄기 · 하루 한도 → 사용자 웹에 반영
  E. 사회관계망 주소       운영 「법정 고지」에서 입력 → 메인 푸터 아이콘이 그 주소로(새 창) · 비우면 「준비 중」
  F. 390px                가로 넘침 없음

메인 카드에는 「순서가 가장 앞선 열린 투표」가 나옵니다 — 시험용 투표 3건(순서 0)을 만들어 그 자리에 올린 뒤 시험하고, 끝에 「감춤」으로 돌립니다.
(넣은 표는 지울 수 없어서, 원래 있던 투표에는 손대지 않습니다.) 공용 설정은 끝에 처음 값으로 되돌립니다.
사용: API=http://localhost:3000 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 python3 srv_poll_ui.py
"""
import json, urllib.request, urllib.error, subprocess, uuid, sys, os, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__))); sys.path.append(__import__('os').environ.get('QA', '/home/claude/qa'))   # v10.31 (w6 사본) — consent_ok 등은 원래 qa 폴더
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

API = (os.environ.get('API') or 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
BO = os.environ.get('BO', 'http://127.0.0.1:5173').rstrip('/')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
OUT = os.path.dirname(os.path.abspath(__file__))
# 「headless」가 들어간 기본 브라우저 이름은 서버가 자동 프로그램으로 보고 표를 받지 않습니다(POLL_BOT) — 보통 브라우저 이름으로 엽니다
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
R = []

q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'user-agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(API + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:260]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:170], file=sys.stderr)

ADM = call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
tag = uuid.uuid4().hex[:6]
SET0 = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in ('poll.guest_vote', 'poll.guest_ip_daily_limit', 'sns.youtube', 'sns.instagram')}
setting = lambda k, v: call('PATCH', '/admin/site-settings', ADM, {'key': k, 'value': v})
made = []
def mk(kind, title, opts, **kw):
    st, j = call('POST', '/admin/community/polls', ADM, {'kind': kind, 'title': title, 'options': opts, 'showOnHome': True, 'sort': 0, **kw})
    made.append(j['id']); call('PATCH', f"/admin/community/polls/{j['id']}", ADM, {'state': 'OPEN'})
    return j['id']
votes = lambda pid: int(q(f"select count(*) from poll_votes where poll_id='{pid}'"))
opts = lambda pid: subprocess.run(['psql', DB, '-tAc', f"select id from poll_options where poll_id='{pid}' order by sort"], capture_output=True, text=True).stdout.split()

T_VS, T_ASK, T_USED = f'화면시험 {tag} 어느 쪽이 좋을까요?', f'화면시험 {tag} 무엇이 중요한가요?', f'화면시험 {tag} 써 보셨나요?'
VS = mk('VS', T_VS, [{'label': '왼쪽', 'sub': '가볍다'}, {'label': '오른쪽', 'sub': '오래 간다'}])
ASK = mk('ASK', T_ASK, [{'label': '가격'}, {'label': '성능'}, {'label': '디자인'}])
USED = mk('USED', T_USED, [{'label': '쓰고 있어요'}, {'label': '써 봤어요'}], description='솔직한 의견을 기다려요.')
card = lambda pid: f'.home-pl[data-poll="{pid}"]'
lcard = lambda pid: f'.poll-card[data-poll="{pid}"]'
main_bo = lambda pg: pg.evaluate("document.querySelector('.bo-main').innerText")
def until(pg, url, cond, tries=9, gap=9000):
    """사용자 웹은 공개 설정을 잠깐 캐시합니다 — 바뀐 값이 보일 때까지 다시 엽니다."""
    for _ in range(tries):
        pg.goto(url, wait_until='networkidle')
        if cond(pg): return True
        pg.wait_for_timeout(gap)
    return False

try:
    with sync_playwright() as p:
        b = p.chromium.launch(); errs = []
        def ctx(w=1280, h=900):
            c = b.new_context(viewport={'width': w, 'height': h}, user_agent=UA); pg = c.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
            pg.on('console', lambda m: errs.append('console: ' + m.text[:160]) if m.type == 'error' and 'favicon' not in m.text else None)
            return c, pg

        # ── A. 메인 카드 (비로그인) ──
        c1, pg = ctx()
        r = pg.goto(SITE + '/', wait_until='networkidle')
        ids = pg.evaluate("[...document.querySelectorAll('.home-pl')].map(x=>[x.dataset.poll,x.dataset.kind,x.dataset.voted,x.querySelector('h3').textContent.trim()])")
        rec('A-1 메인 「이건 어때?」 3장 = 서버의 투표(종류마다 순서가 가장 앞선 열린 투표)', r.status == 200 and ids == [[VS, 'VS', '0', T_VS], [ASK, 'ASK', '0', T_ASK], [USED, 'USED', '0', T_USED]], ids)
        tot = pg.eval_on_selector_all('.home-plf [data-total]', 'e=>e.map(x=>x.textContent.trim())')
        txt = pg.inner_text('.home-band.poll')
        rec('A-2 참여 수 0명에서 시작(실제 표 수) · 그림의 3,482 · 4,219 · 812 없음 · 투표 전에는 비율이 안 보임', tot == ['0명 참여'] * 3 and not re.search(r'3,482|4,219|812명', txt) and '%' not in txt
            and pg.locator('.home-pl li.res').count() == 0, tot)
        rec('A-3 버튼 — 투표하기 · 투표하기 · 의견 남기기 · 「전체보기」는 투표 목록으로', [x.strip() for x in pg.eval_on_selector_all('.home-pl [data-vote]', 'e=>e.map(x=>x.textContent)')] == ['투표하기', '투표하기', '의견 남기기']
            and pg.get_attribute('.home-band.poll .home-sh a', 'href') == '/community/polls')
        pg.click(card(ASK) + ' [data-vote]'); pg.wait_for_timeout(300)
        rec('A-4 고르지 않고 「투표하기」 → 「보기를 먼저 골라 주세요.」 · 표 0', '보기를 먼저 골라 주세요' in pg.inner_text(card(ASK) + ' .home-plmsg') and votes(ASK) == 0)
        ao = opts(ASK)
        pg.click(card(ASK) + f' [data-opt="{ao[1]}"]')
        rec('A-5 보기를 누르면 고른 표시', pg.get_attribute(card(ASK) + f' [data-opt="{ao[1]}"]', 'aria-checked') == 'true' and pg.locator(card(ASK) + ' li.on').count() == 1)
        pg.click(card(ASK) + ' [data-vote]'); pg.wait_for_selector(card(ASK) + '[data-voted="1"]', timeout=8000)
        rec('A-6 「투표하기」 → 투표됨 · 1명 참여 · 「투표했습니다」 · 비율(성능 100%) · DB 1표', pg.inner_text(card(ASK) + ' [data-total]') == '1명 참여' and pg.inner_text(card(ASK) + ' [data-done]') == '투표했습니다'
            and pg.eval_on_selector_all(card(ASK) + ' li em', 'e=>e.map(x=>x.textContent)') == ['0%', '100%', '0%'] and votes(ASK) == 1
            and '투표했습니다' in pg.inner_text(card(ASK) + ' .home-plmsg'), pg.eval_on_selector_all(card(ASK) + ' li em', 'e=>e.map(x=>x.textContent)'))
        ck = [c for c in c1.cookies() if c['name'] == 'sgb_visitor']
        dbk = q(f"select visitor_key||'|'||(account_id is null)::text||'|'||length(coalesce(ip_hash,'')) from poll_votes where poll_id='{ASK}'")
        rec('A-7 방문자 쿠키(sgb_visitor)가 생기고, 그 값으로 표가 기록됨(계정 없음 · 주소는 해시)', len(ck) == 1 and dbk == f"{ck[0]['value']}|true|64" and ck[0]['sameSite'] == 'Lax', dbk)
        rec('A-8 투표한 카드에는 버튼 · 고르기가 없음(1인 1표)', pg.locator(card(ASK) + ' [data-vote]').count() == 0 and pg.locator(card(ASK) + ' button:not([disabled])').count() == 0)
        pg.reload(wait_until='networkidle')
        rec('A-9 새로고침 뒤에도 「투표했습니다」 · 내가 고른 보기 표시 · 1명 참여', pg.get_attribute(card(ASK), 'data-voted') == '1' and pg.inner_text(card(ASK) + ' [data-total]') == '1명 참여'
            and pg.locator(card(ASK) + ' li.on').count() == 1 and pg.inner_text(card(ASK) + ' li.on').startswith('성능'))
        vo = opts(VS)
        pg.click(card(VS) + f' [data-opt="{vo[0]}"]'); pg.click(card(VS) + ' [data-vote]'); pg.wait_for_selector(card(VS) + '[data-voted="1"]', timeout=8000)
        vs = pg.inner_text(card(VS) + ' .home-vs').replace('\n', ' ')
        rec('A-10 비교해요 — 왼쪽에 투표 → 「100% · 1표」 / 「0% · 0표」', '100% · 1표' in vs and '0% · 0표' in vs and votes(VS) == 1, vs)
        st = pg.evaluate("""async(a)=>{const r=await fetch('/api/v1/community/polls/'+a[0]+'/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({optionId:a[1]})});return r.status}""", [ASK, ao[0]])
        rec('A-11 같은 브라우저에서 투표 요청을 다시 보내도 409 · 표는 그대로', st == 409 and votes(ASK) == 1, st)
        st = pg.evaluate("""async(a)=>{const r=await fetch('/api/v1/community/polls/'+a[0]+'/vote',{method:'POST',headers:{'Content-Type':'application/json','X-Visitor-Key':'forged-key-0001'},body:JSON.stringify({optionId:a[1]})});return r.status}""", [ASK, ao[0]])
        rec('A-12 방문자 키를 헤더로 꾸며 보내도 409 — 사용자 웹이 쿠키 값으로 덮어씀', st == 409 and votes(ASK) == 1 and q("select count(*) from poll_votes where visitor_key='forged-key-0001'") == '0', st)

        # ── C. 소개광장 투표 목록 ──
        pg.click('.home-band.poll .home-sh a'); pg.wait_for_url('**/community/polls'); pg.wait_for_load_state('networkidle')
        cards = pg.evaluate("[...document.querySelectorAll('.poll-card')].map(x=>[x.dataset.poll,x.dataset.voted])")
        d = dict(cards)
        rec('C-1 「전체보기」 → /community/polls · 제목 「이건 어때?」 · 메인에서 넣은 표가 그대로(2건 투표함 · 1건 아직)', pg.inner_text('h1') == '이건 어때?' and d.get(VS) == '1' and d.get(ASK) == '1' and d.get(USED) == '0', len(cards))
        n_open = int(q("select count(*) from polls where state='OPEN' and (ends_at is null or ends_at > now())")); n_all = int(q("select count(*) from polls where state in ('OPEN','CLOSED')"))
        rec('C-2 건수 = DB (진행 중 · 마감) · 준비 중 · 감춘 투표는 없음', pg.get_attribute('[data-poll-count]', 'data-poll-count') == str(min(n_all, 60))
            and f'진행 중 {n_open}건' in pg.inner_text('[data-poll-count]') and len(cards) == min(n_all, 60), pg.inner_text('[data-poll-count]'))
        rec('C-3 안내 — 로그인 없이 투표 · 한 번만 · 실제로 투표한 수', all(x in pg.inner_text('.notice') for x in ('로그인 없이 투표', '한 번만', '실제로 투표한 수')))
        uo = opts(USED)
        pg.click(lcard(USED) + f' [data-opt="{uo[1]}"]'); pg.click(lcard(USED) + ' [data-vote]'); pg.wait_for_selector(lcard(USED) + '[data-voted="1"]', timeout=8000)
        rec('C-4 목록에서 「의견 남기기」 → 투표됨 · 「100% · 1표」 · DB 1표', '100% · 1표' in pg.inner_text(lcard(USED)) and pg.inner_text(lcard(USED) + ' [data-total]') == '1명 참여' and votes(USED) == 1)
        pg.goto(SITE + '/community', wait_until='networkidle')
        rec('C-5 소개광장 글 목록에 「이건 어때? 투표」 탭 → /community/polls', pg.get_attribute('[data-polls-tab]', 'href') == '/community/polls')
        pg.goto(SITE + '/', wait_until='networkidle')
        rec('C-6 메인 — 3장 모두 「투표했습니다」', [pg.get_attribute(card(x), 'data-voted') for x in (VS, ASK, USED)] == ['1', '1', '1'])

        # ── B. 다른 방문자 · 회원 ──
        c2, g2 = ctx()
        g2.goto(SITE + '/', wait_until='networkidle')
        rec('B-1 다른 기기(새 방문자) — 아직 투표 안 함 · 참여 수는 1명 그대로 · 비율은 안 보임', [g2.get_attribute(card(x), 'data-voted') for x in (VS, ASK, USED)] == ['0', '0', '0']
            and g2.eval_on_selector_all('.home-plf [data-total]', 'e=>e.map(x=>x.textContent.trim())') == ['1명 참여'] * 3 and g2.locator('.home-pl li.res').count() == 0)
        g2.click(card(ASK) + f' [data-opt="{ao[0]}"]'); g2.click(card(ASK) + ' [data-vote]'); g2.wait_for_selector(card(ASK) + '[data-voted="1"]', timeout=8000)
        rec('B-2 다른 기기가 「가격」에 투표 → 2명 참여 · 50% / 50% / 0%', g2.inner_text(card(ASK) + ' [data-total]') == '2명 참여'
            and g2.eval_on_selector_all(card(ASK) + ' li em', 'e=>e.map(x=>x.textContent)') == ['50%', '50%', '0%'] and votes(ASK) == 2)
        pg.goto(SITE + '/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2000)
        pg.goto(SITE + '/', wait_until='networkidle')
        inn = pg.locator('.home-hd').inner_text()
        rec('B-3 같은 브라우저로 로그인 — 회원은 계정으로 따로 1표: 3장 다시 투표 가능 · 참여 수는 그대로', '나의공간' in inn and '무료 회원가입' not in inn and [pg.get_attribute(card(x), 'data-voted') for x in (VS, ASK, USED)] == ['0', '0', '0']
            and pg.inner_text(card(ASK) + ' [data-total]') == '2명 참여', inn[-40:].replace('\n', ' '))
        pg.click(card(VS) + f' [data-opt="{vo[1]}"]'); pg.click(card(VS) + ' [data-vote]'); pg.wait_for_selector(card(VS) + '[data-voted="1"]', timeout=8000)
        vs = pg.inner_text(card(VS) + ' .home-vs').replace('\n', ' ')
        rec('B-4 회원이 오른쪽에 투표 → 2명 참여 · 50% · 1표씩 · DB 에 계정으로 기록', pg.inner_text(card(VS) + ' [data-total]') == '2명 참여' and vs.count('50% · 1표') == 2
            and q(f"select count(*) from poll_votes v join accounts a on a.id=v.account_id where v.poll_id='{VS}' and a.email='buyer@x.com'") == '1', vs)
        pg.reload(wait_until='networkidle')
        rec('B-5 새로고침 뒤에도 회원의 표가 남음', pg.get_attribute(card(VS), 'data-voted') == '1' and pg.get_attribute(card(ASK), 'data-voted') == '0')

        # ── D. 운영 화면 ──
        c3, bo = ctx(1440, 900)
        said = []
        reason = {'v': ''}
        bo.on('dialog', lambda dlg: (said.append(dlg.message[:60]), dlg.accept(reason['v']) if dlg.type == 'prompt' else dlg.accept()))
        bo.goto(BO); bo.wait_for_timeout(600); __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); bo.fill('input[name=email]', 'admin@x.com'); bo.fill('input[name=password]', 'sgb-dev-1234'); bo.click('form button[type=submit]'); bo.wait_for_timeout(1500)
        _bo_tab(bo, '이건 어때? 투표'); bo.wait_for_selector('[data-polls-admin] table', timeout=10000)   # v10.29 — 묶음 단추 → .ad-snb 탭
        row = lambda pid: f'[data-polls-admin] tr[data-poll="{pid}"]'
        rec('D-1 운영 「이건 어때? 투표」 탭 — 시험 투표 3건이 「진행 중」 · 참여 수 = DB', all(bo.get_attribute(row(x), 'data-state') == 'OPEN' for x in (VS, ASK, USED))
            and [bo.inner_text(row(x) + ' td:nth-child(4)').strip() for x in (VS, ASK, USED)] == [str(votes(x)) for x in (VS, ASK, USED)], [votes(x) for x in (VS, ASK, USED)])
        rec('D-2 보기별 표 · 비율이 줄마다 · 「나가는 중」 3건 · 메인에 나가는 투표 3 / 3', '가격 1표(50%)' in bo.inner_text(row(ASK)) and bo.inner_text('[data-polls-admin] table').count('나가는 중') == 3
            and '메인에 나가는 투표 3 / 3' in main_bo(bo).replace('\n', ' '), bo.inner_text(row(ASK))[:80])
        # 만들기
        NEW_T = f'화면시험 {tag} 운영에서 만든 투표'
        bo.click('[data-poll-create] button')
        rec('D-3 제목 없이 「만들기」 → 「제목을 4자 이상」', '제목을 4자 이상' in main_bo(bo))
        bo.select_option('select[name=poll-kind]', 'VS'); bo.fill('input[name=poll-title]', NEW_T); bo.fill('textarea[name=poll-options]', '가 | 설명\n나\n다'); bo.uncheck('input[name=poll-home]')
        bo.click('[data-poll-create] button')
        rec('D-4 「비교해요」에 보기 3개 → 거절(정확히 2개)', '정확히 2개' in main_bo(bo) and q(f"select count(*) from polls where title='{NEW_T}'") == '0')
        bo.fill('textarea[name=poll-options]', '가 | 설명\n나'); bo.click('[data-poll-create] button'); bo.wait_for_timeout(1500)
        NEW = q(f"select id from polls where title='{NEW_T}'"); made.append(NEW) if NEW else None
        rec('D-5 보기 2개로 만들기 → 「준비 중」으로 생김 · 메인에 내기 꺼짐 · 사용자 웹에는 아직 없음', bool(NEW) and bo.get_attribute(row(NEW), 'data-state') == 'DRAFT'
            and q(f"select show_on_home::text from polls where id='{NEW}'") == 'false' and call('GET', f'/community/polls/{NEW}')[0] == 404, NEW)
        bo.locator(row(NEW) + ' button', has_text='열기').click(); bo.wait_for_timeout(1500)
        rec('D-6 「열기」 → 진행 중 · 사용자 웹 목록에 나옴', bo.get_attribute(row(NEW), 'data-state') == 'OPEN' and '열었습니다' in main_bo(bo))
        g2.goto(SITE + '/community/polls', wait_until='networkidle')
        rec('D-7 사용자 웹 /community/polls 에 새 투표(0명 참여 · 투표 가능)', g2.locator(lcard(NEW)).count() == 1 and g2.inner_text(lcard(NEW) + ' [data-total]') == '0명 참여' and g2.locator(lcard(NEW) + ' [data-vote]').count() == 1)
        # 비로그인 끄기
        bo.locator('input[name=guest-vote]').nth(1).click(); bo.wait_for_timeout(1800)   # 저장이 끝나야 표시가 바뀝니다(서버 값으로 그림)
        rec('D-8 「로그인 회원만」으로 바꿈 → 설정 off', q("select value from site_settings where key='poll.guest_vote'") == 'off' and '로그인 회원만 투표하게 했습니다' in main_bo(bo))
        no = opts(NEW)
        g2.click(lcard(NEW) + f' [data-opt="{no[0]}"]'); g2.click(lcard(NEW) + ' [data-vote]'); g2.wait_for_selector(lcard(NEW) + ' .poll-msg', timeout=8000)
        rec('D-9 비로그인이 투표 → 「로그인한 회원만 투표할 수 있습니다」 + 로그인 링크 · 표 0', '로그인한 회원만 투표할 수 있습니다' in g2.inner_text(lcard(NEW) + ' .poll-msg')
            and g2.get_attribute(lcard(NEW) + ' .poll-msg a', 'href') == '/login' and votes(NEW) == 0, g2.inner_text(lcard(NEW) + ' .poll-msg'))
        bo.locator('input[name=guest-vote]').nth(0).click(); bo.wait_for_timeout(1800)
        g2.click(lcard(NEW) + ' [data-vote]'); g2.wait_for_selector(lcard(NEW) + '[data-voted="1"]', timeout=8000)
        rec('D-10 다시 「비로그인도 가능」 → 투표가 들어감(1명 참여)', q("select value from site_settings where key='poll.guest_vote'") == 'on' and votes(NEW) == 1)
        bo.fill('input[name=guest-ip-limit]', '7'); bo.locator('input[name=guest-ip-limit]').blur(); bo.wait_for_timeout(1500)
        rec('D-11 하루 한도 7 로 바꿈 → 설정 저장', q("select value from site_settings where key='poll.guest_ip_daily_limit'") == '7' and '하루 한도를 바꿨습니다' in main_bo(bo))
        # 마감 · 감추기
        bo.locator(row(NEW) + ' button', has_text='마감').click(); bo.wait_for_timeout(1500)
        g2.reload(wait_until='networkidle')
        rec('D-12 「마감」 → 사용자 웹에 「마감」 · 결과는 보임 · 투표 버튼 없음', bo.get_attribute(row(NEW), 'data-state') == 'CLOSED' and '마감' in g2.inner_text(lcard(NEW) + ' .poll-state')
            and g2.locator(lcard(NEW) + ' [data-vote]').count() == 0 and '100% · 1표' in g2.inner_text(lcard(NEW)))
        reason['v'] = '짧음'
        bo.locator(row(NEW) + ' button', has_text='감추기').click(); bo.wait_for_timeout(800)
        rec('D-13 사유 3자로 「감추기」 → 거절(5자 이상) · 그대로 마감', '5자 이상' in main_bo(bo) and q(f"select state from polls where id='{NEW}'") == 'CLOSED' and any('사유' in s for s in said), said[-1:])
        reason['v'] = '화면 시험 자료 정리'
        bo.locator(row(NEW) + ' button', has_text='감추기').click(); bo.wait_for_timeout(1500)
        g2.reload(wait_until='networkidle')
        rec('D-14 사유를 적고 감추기 → 감춤 · 사유 표시 · 사용자 웹 목록에서 빠짐', bo.get_attribute(row(NEW), 'data-state') == 'HIDDEN' and '감춘 사유: 화면 시험 자료 정리' in bo.inner_text(row(NEW))
            and g2.locator(lcard(NEW)).count() == 0)
        # 메인 노출 끄기
        bo.locator(row(USED) + ' button[data-poll-home]', has_text='메인에서 빼기').click(); bo.wait_for_timeout(1800)   # v10.31 (w6 · 10/10 시안) — 칸 → 「메인에서 빼기」 단추
        g2.goto(SITE + '/', wait_until='networkidle')
        seed_used = q(f"select id from v_poll_home where kind='USED'")
        rec('D-15 「메인에 내기」를 끄면 메인 카드가 다음 순서의 투표로 바뀜', q(f"select show_on_home::text from polls where id='{USED}'") == 'false' and seed_used != USED
            and g2.get_attribute('.home-pl[data-kind=USED]', 'data-poll') == seed_used, seed_used)

        # ── E. 사회관계망 주소 ──
        g2.goto(SITE + '/', wait_until='networkidle')
        sns = g2.evaluate("[...document.querySelectorAll('.home-sns [data-sns]')].map(x=>[x.tagName,x.dataset.sns,x.getAttribute('href')])")
        rec('E-1 메인 푸터 아이콘 4개 — 주소가 없는 것은 「준비 중」(연결 없음)', len(sns) == 4 and all((s[0] == 'SPAN') == (not SET0.get(s[1], '')) for s in sns if s[1] in SET0), sns)
        _bo_tab(bo, '법정 고지'); bo.wait_for_selector('[data-sns-settings]', timeout=10000)   # v10.29 — 묶음 단추 → .ad-snb 탭
        rec('E-2 운영 「법정 고지」에 사회관계망 주소 칸 4개', bo.locator('[data-sns-settings] input').count() == 4 and 'https:// 로 시작하는 주소' in bo.inner_text('[data-sns-settings]'))
        bo.fill('input[name="sns.youtube"]', 'http://www.youtube.com/@sogaebank'); bo.locator('input[name="sns.youtube"]').blur(); bo.wait_for_timeout(1500)
        rec('E-3 http:// 주소 → 저장 안 됨(안내 표시)', q("select coalesce(value,'') from site_settings where key='sns.youtube'") == SET0['sns.youtube'] and bo.locator('.form-error').count() >= 1, bo.locator('.form-error').first.inner_text()[:80] if bo.locator('.form-error').count() else '')
        URL = f'https://www.youtube.com/@sogaebank_{tag}'
        bo.fill('input[name="sns.youtube"]', URL); bo.locator('input[name="sns.youtube"]').blur(); bo.wait_for_timeout(1500)
        rec('E-4 https:// 주소 → 저장 · 「연결됨」', q("select value from site_settings where key='sns.youtube'") == URL and '연결됨' in bo.inner_text('[data-sns-settings]'))
        ok = until(g2, SITE + '/', lambda x: x.locator('.home-sns a[data-sns="sns.youtube"]').count() == 1)
        a = g2.evaluate("(()=>{const a=document.querySelector('.home-sns a[data-sns=\"sns.youtube\"]');return a?[a.getAttribute('href'),a.target,a.rel,a.className]:null})()")
        rec('E-5 메인 푸터 유튜브 아이콘이 그 주소로(새 창 · noopener) — 사용자 웹에 반영', ok and a == [URL, '_blank', 'noopener noreferrer', 'home-snsi on'], a)
        bo.fill('input[name="sns.youtube"]', SET0['sns.youtube']); bo.locator('input[name="sns.youtube"]').blur(); bo.wait_for_timeout(1500)
        ok = until(g2, SITE + '/', lambda x: (x.locator('.home-sns a[data-sns="sns.youtube"]').count() == 1) == bool(SET0['sns.youtube']))
        rec('E-6 처음 값으로 되돌리면 아이콘도 처음 상태로', ok and q("select coalesce(value,'') from site_settings where key='sns.youtube'") == SET0['sns.youtube'])

        # ── F. 390px ──
        cm, mp = ctx(390, 800)
        over = []
        for u in ('/', '/community/polls', '/community'):
            mp.goto(SITE + u, wait_until='networkidle')
            w = mp.evaluate('[document.documentElement.scrollWidth, innerWidth]')
            if w[0] > w[1] + 1: over.append((u, w))
        rec('F-1 390px — 메인 · 투표 목록 · 소개광장 가로 넘침 없음', not over, over)
        mp.goto(SITE + '/', wait_until='networkidle')
        mp.locator('.home-band.poll').scroll_into_view_if_needed(); mp.screenshot(path=os.path.join(OUT, 'srv_poll_ui_390.png'))
        pg.goto(SITE + '/community/polls', wait_until='networkidle'); pg.screenshot(path=os.path.join(OUT, 'srv_poll_ui_list.png'), full_page=True)
        pg.goto(SITE + '/', wait_until='networkidle'); pg.locator('.home-band.poll').scroll_into_view_if_needed(); pg.locator('.home-band.poll').screenshot(path=os.path.join(OUT, 'srv_poll_ui_main.png'))
        hyd = [e for e in errs if '#418' in e or 'Hydration' in e or 'hydrat' in e]
        real = [e for e in errs if 'Failed to load resource' not in e]
        rec('Z-0 브라우저 오류 0 (수화 오류 포함) — 401 · 409 · 422 응답은 의도한 것', not hyd and not real, (hyd[:2], real[:3]))
        b.close()
finally:
    for k, v in SET0.items(): setting(k, v)
    back = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in SET0}
    rec('Z-1 공용 설정을 처음 값으로 되돌림', back == SET0, back)
    for pid in made:
        if pid and q(f"select state from polls where id='{pid}'") != 'HIDDEN':
            call('PATCH', f'/admin/community/polls/{pid}', ADM, {'state': 'HIDDEN', 'hiddenReason': '시험 자료 정리(srv_poll_ui.py)'})
    rec('Z-2 시험 투표는 모두 「감춤」 — 메인은 원래 투표 3건으로 돌아옴', q("select count(*) from polls where title like '화면시험 %' and state <> 'HIDDEN'") == '0' and q("select count(*) from v_poll_home") == '3')

json.dump(R, open(os.path.join(OUT, 'srv_poll_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
