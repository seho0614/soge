"""flow 점검 공용 도구 — 흐름(flow)을 단계별로 기록합니다.  (v10.25 점검 보강 · 2026-10-08)

  from flow_lib import *
  F = Flow('F4 소개몰 주문 → 결제 → 배송 → 반품', '구매자 buyer@x.com · 운영자 admin@x.com')
  F.step('상품 상세에서 「담기」를 누름', '화면', ok, '자세한 값')        # how = '화면' | 'API' | 'DB' | '운영 화면' | '시안'
  …
  finish('mall')         # flow_mall.json 을 쓰고 「통과 n / m」 한 줄을 찍음

규칙
  · 단계의 ok 는 실제로 확인한 값으로만 정합니다. 실패는 실패로 남깁니다(기대값을 낮추지 않음).
  · 상태를 바꾸는 단계 뒤에는 DB 에서 그 행을 확인하는 단계를 둡니다.
  · 만든 자료는 끝에 치웁니다(주문은 취소 · 승인 → 재고 복원, 글은 삭제 …). 계정(flw_*@t.local)은 남습니다.
"""
import json, os, re, subprocess, sys, time, uuid, urllib.request, urllib.error

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
API = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
BO = os.environ.get('BO', 'http://127.0.0.1:5173')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
DEV_PW = 'sgb-dev-1234'          # *@x.com 계정
TEST_PW = 'sgb-test-1234'        # *@t.local 운영 시험 계정(ops · reviewer · payout · member)
FLOWS = []

class Flow:
    def __init__(self, name, who=''):
        self.d = {'flow': name, 'who': who, 'steps': []}; FLOWS.append(self.d)
        print(f'\n== {name}', file=sys.stderr, flush=True)
    def step(self, step, how, ok, detail='', skip=False):
        n = len(self.d['steps']) + 1
        self.d['steps'].append({'no': n, 'step': step, 'how': how, 'ok': bool(ok), 'detail': str(detail)[:300], **({'skip': True} if skip else {})})
        print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), f'{n:>2}', f'[{how}]', step, '|', str(detail)[:160], file=sys.stderr, flush=True)
        return bool(ok)

def finish(name):
    json.dump(FLOWS, open(f'{HERE}/flow_{name}.json', 'w'), ensure_ascii=False, indent=1)
    steps = [s for f in FLOWS for s in f['steps']]
    skip = [s for s in steps if s.get('skip')]; bad = [s for s in steps if not s['ok'] and not s.get('skip')]
    for f in FLOWS:
        b = [s for s in f['steps'] if not s['ok'] and not s.get('skip')]; k = [s for s in f['steps'] if s.get('skip')]
        print(('!! ' if b else '   ') + f"{f['flow']} — 통과 {len(f['steps']) - len(b) - len(k)} / {len(f['steps'])}" + (f" · 실패 {len(b)}" if b else '') + (f" · 건너뜀 {len(k)}" if k else ''), file=sys.stderr)
    print(f"통과 {len(steps) - len(bad) - len(skip)} / {len(steps)} · 흐름 {len(FLOWS)}개" + (f" · 실패 {len(bad)}" if bad else '') + (f" · 건너뜀 {len(skip)}" if skip else ''))

# ── DB ──
def rows(sql_, db=None):
    p = subprocess.run(['psql', db or DB, '-tA', '-F', '\t', '-c', sql_], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return [l.split('\t') for l in p.stdout.strip().split('\n') if l]
def q(sql_, db=None):
    r = rows(sql_, db); return r[0][0] if r else ''
def sql(s):
    """쓰기 SQL — 뒷정리나 「시간이 지난 것처럼」 만드는 준비에만 씁니다. 반환 (종료 코드, 오류 글)"""
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qc', s], capture_output=True, text=True); return p.returncode, p.stderr.strip()

# ── API ──
def call(m, p, tok=None, body=None, headers=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'user-agent': UA, **(headers or {})}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None)
    req = urllib.request.Request(API + p, method=m, data=data, headers=h)
    try: r = urllib.request.urlopen(req, timeout=40); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js
def login(email, pw=None):
    pw = pw or (DEV_PW if email.endswith('@x.com') else TEST_PW)
    return (call('POST', '/auth/login', body={'email': email, 'password': pw})[1] or {}).get('accessToken')
def agree_pending(tok):
    """v10.28 (재동의) — 동의하지 않은 필수 약관에 동의(사이트 가입 화면 · 동의 화면이 하는 것과 같음). 동의한 약관 코드 목록을 돌려줍니다.
    사이트는 필수 약관에 동의하지 않은 회원을 로그인이 필요한 화면에서 동의 화면으로 보냅니다 — 화면 시험의 회원은 먼저 동의해 둡니다."""
    if not tok: return []
    st, lst = call('GET', '/terms/required', tok)
    items = [{'code': t['code'], 'agreed': True} for t in (lst or []) if isinstance(t, dict) and t.get('isRequired') and not t.get('agreed')]
    if items: call('POST', '/terms/agree', tok, {'items': items})
    return [i['code'] for i in items]
def signup(prefix='flw', name='흐름 시험', pw='Sgb-flw-1234!', agree=True):
    """새 일반 회원 — (email, password, accessToken, account id). agree=False 면 필수 약관에 동의하지 않은 채(재동의 시험)"""
    em = f'{prefix}_{uuid.uuid4().hex[:6]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': pw, 'name': name, 'agreedTerms': []})
    tok = (j or {}).get('accessToken') or login(em, pw)
    if agree: agree_pending(tok)
    return em, pw, tok, q(f"select id from accounts where email='{em}'")

# ── 브라우저(사용자 웹) ──
def site_login(ctx, email, pw=None, agree=True):
    """사용자 웹에 로그인한 쪽(page)을 돌려줍니다 — 로그인 폼을 실제로 채워 누릅니다"""
    pw = pw or (DEV_PW if email.endswith('@x.com') else TEST_PW)
    if agree: agree_pending(login(email, pw))      # v10.28 — 필수 약관 동의 전이면 동의 화면으로 가므로 먼저 동의(재동의 시험은 agree=False)
    pg = ctx.new_page()
    pg.goto(SITE + '/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form.auth button'); pg.wait_for_timeout(2500)
    return pg
def text(pg, sel='body'):
    try: return pg.inner_text(sel)
    except Exception: return ''
def goto(pg, path, wait='networkidle'):
    try: r = pg.goto(SITE + path if path.startswith('/') else path, wait_until=wait, timeout=30000); return r.status if r else 0
    except Exception: return -1
def watch(pg):
    """쪽 오류 · 실패한 API 응답을 모으는 목록 둘을 돌려줍니다 (errs, apis)"""
    errs, apis = [], []
    pg.on('pageerror', lambda e: errs.append(f"{pg.url.split('//', 1)[-1].split('/', 1)[-1][:60]} — {str(e)[:150]}"))      # v10.28 — 어느 쪽에서 났는지(주소)를 앞에
    pg.on('response', lambda r: apis.append(f"{r.status} {r.request.method} {r.url.split('/api/v1')[-1][:60]}") if '/api/' in r.url and r.status >= 400 else None)
    return errs, apis

# ── 브라우저(운영 화면) ──
def bo_login(ctx, email='admin@x.com', pw=None):
    pw = pw or (DEV_PW if email.endswith('@x.com') else TEST_PW)
    pg = ctx.new_page(); pg.goto(BO); pg.wait_for_timeout(800)
    pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw); pg.click('form button[type=submit]')
    try: pg.wait_for_selector('.bo-head nav button', timeout=30000)      # 운영 화면을 막 올린 뒤 첫 화면은 늦게 뜹니다(개발 서버가 처음 한 번 묶음을 만듦)
    except Exception: pass
    pg.wait_for_timeout(600)
    return pg
# v10.29 — 운영 화면 메뉴가 「묶음(상단 .bo-head nav button · data-tabs="|탭|탭|") → 묶음 안 탭(.bo-main .ad-snb button[data-tab])
#           → 화면 안 하위 탭(.bo-main .subtabs)」 3단이 되었습니다. 탭 글자는 예전 그대로입니다.
BO_GROUP = '.bo-head nav button'            # v10.29 묶음 단추
BO_SNB = '.bo-main .ad-snb button[data-tab]'   # v10.29 묶음 안 탭(탭이 하나뿐인 묶음은 줄이 없음)
def bo_groups(pg):
    """v10.29 — [(묶음 글자, [탭 글자 …]), …] 지금 계정에게 보이는 것만"""
    return [(g, [t for t in (ts or '').split('|') if t]) for g, ts in pg.evaluate(
        "[...document.querySelectorAll('.bo-head nav button')].map(b=>[b.innerText.trim(), b.getAttribute('data-tabs')])")]
def bo_tab_names(pg):
    """v10.29 — 보이는 탭 글자 전부(묶음 순서대로) — 예전 `.bo-head nav button` 글자 목록과 같은 뜻"""
    return [t for _, ts in bo_groups(pg) for t in ts]
# v10.31 (w6 · 10/10 시안 기준) — 시안 글자로 바뀐 탭 · 하위 탭. 옛 글자로 불러도 새 글자로 누릅니다.
BO_TAB_ALIAS = {'소개광장 검수': '글 검수'}
BO_SUB_ALIAS = {'파트너 목록': '파트너사 목록', '입점 신청 (T-01)': '입점 신청', '서비스 검수 (T-02)': '서비스 검수',
                '리드 반려 (T-04)': '리드 반려', '이용료 · 등급': '리드 이용료 · 정산'}
# v10.31 — 하위 탭 줄에 있으나 누르면 다른 탭으로 옮겨 가는 단추(SubTabs out → data-out). 상태 전환으로 세지 않습니다.
BO_SUBTAB_BTN = 'button:not([data-out])'
def bo_tab(pg, name, sub=None, sub2=None):
    """탭 · 하위 탭을 **글자가 꼭 같은 것**으로 누릅니다(「광고」가 「광고 과금」에 걸리지 않게 — G-170). 못 찾으면 False
    v10.29 — 탭 name 이 든 묶음 단추(data-tabs 에 |name|)를 누르고, 묶음 안 탭 줄(.ad-snb)이 있으면 글자 name 인 탭을 누릅니다."""
    def click_exact(loc, label):
        n = loc.count()
        for i in range(n):
            if loc.nth(i).inner_text().strip() == label:
                loc.nth(i).click(); pg.wait_for_timeout(900); return True
        return False
    name = BO_TAB_ALIAS.get(name, name); sub = BO_SUB_ALIAS.get(sub, sub) if sub else sub        # v10.31
    grp = pg.locator(f'{BO_GROUP}[data-tabs*="|{name}|"]')                    # v10.29
    if grp.count() == 0: return False
    grp.first.click(); pg.wait_for_timeout(700)
    if pg.locator(BO_SNB).count() and not click_exact(pg.locator(BO_SNB), name): return False      # v10.29 — 탭이 하나면 줄이 없음
    if pg.locator('.bo-main').get_attribute('data-tab') is None: return False
    if sub and not click_exact(pg.locator('.bo-main .subtabs').first.locator(BO_SUBTAB_BTN), sub): return False      # v10.31 — data-out 빼고
    if sub2 and not click_exact(pg.locator('.bo-main .subtabs').nth(1).locator(BO_SUBTAB_BTN), sub2): return False
    try: pg.wait_for_load_state('networkidle', timeout=5000)
    except Exception: pass
    return True
