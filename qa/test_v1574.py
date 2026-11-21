"""v10.574 (docs/716) 11차 회원 · 거래 ② 가짜 후기 · 리뷰 탐지 — 스위치 mtr.review_watch(처음 off) · 의심 목록만 · 자동 삭제 없음
  ① (코드) 의심 표 · 신호 5가지 · 글자 짝 겹침 식(파이썬으로 같은 식) · 후기 표 DELETE 없음 · 가짜 후기는 신뢰 점수에서 뺌
  ② (DB · API) 시험 계정 두 개가 같은 글로 남의 거래에 쓴 후기(replica 로 넣음) → 꺼져 있으면 작업 건너뜀 · 지금 보기 75점 두 줄 · 목록 가림 · 결정 422 · 됨 · 409 · 400 · 다시 보기는 결정 안 덮음
  (두 번 돌아도 통과 — 「시험1574」 후기 · 시험 중 생긴 의심 줄은 끝에 replica 로 지움 · 설정은 되돌림)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def migr_has(word):
    """그 낱말이 든 마이그레이션(번호는 합칠 때 정해짐)"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


"""시험 몸통"""
import uuid
MS = migr_has('mtr_review_flags')
RW = rd('src/modules/mtr/review-watch.ts')
TR = rd('src/modules/mtr/trust.ts')
CT = rd('src/modules/mtr/mtr.controller.ts')
D716 = doc('716_')
SIG = ['SAME_DEVICE', 'BURST', 'SIMILAR', 'NO_DEAL', 'NEW_ACCOUNT']
ok('① 코드 — 의심 목록 표(신호 5가지 CHECK · 결정 한 번) · 신호 점수 · 글자 짝 겹침 · 자동 삭제 없음(후기 표 DELETE 없음) · 가짜 후기는 신뢰 점수에서 뺌 · 문서 716 · 판',
   'CREATE TABLE IF NOT EXISTS public.mtr_review_flags' in MS and all(f"'{x}'" in MS for x in SIG) and 'uq_mtr_review_flag' in MS
   and all(x in RW for x in SIG) and 'bigramSimilarity' in RW and 'judgeReviews' in RW
   and not re.search(r'DELETE\s+FROM\s+(deal_reviews|hlt_reviews)', RW) and "f.state = 'FAKE'" in MS
   and "Post('admin/mtr/reviews/scan')" in CT and '자동' in D716 and VT >= (10, 574), VER)


def bigram(a, b):
    """서버 bigramSimilarity 와 같은 식(빈칸 · 문장부호 빼고 2글자 짝 Jaccard)"""
    n = lambda s: re.sub(r'[\s\W_]+', '', (s or '').lower())
    x, y = n(a), n(b)
    if len(x) < 2 or len(y) < 2:
        return 0
    A = {x[i:i + 2] for i in range(len(x) - 1)}; B = {y[i:i + 2] for i in range(len(y) - 1)}
    return round(len(A & B) / len(A | B) * 100)


ok('① 식 — 같은 글 100 · 빈칸 · 문장부호만 달라도 100 · 다른 글은 낮음',
   bigram('정말 친절했어요!', '정말친절했어요') == 100 and bigram('가나다라마바사', '아자차카타파하') == 0, '')

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    T0 = psql("SELECT now()::text")
    deal = psql("SELECT id FROM deals ORDER BY created_at LIMIT 1")
    old = {k: getset(k) for k in ('mtr.review_watch', 'mtr.review_threshold')}
    ids = []
    CLEAN = lambda: psql(f"SET session_replication_role = replica; DELETE FROM mtr_review_flags WHERE created_at >= '{T0}' OR review_id IN (SELECT id FROM deal_reviews WHERE body LIKE '시험1574%'); DELETE FROM deal_reviews WHERE body LIKE '시험1574%';")
    CLEAN()
    if not deal or deal.startswith('!'):
        print('  (거래 없음 — ② 건너뜀)')
    else:
        try:
            e1, a1 = mk_staff('1574a', None)
            e2, a2 = mk_staff('1574b', None)
            tgt = str(uuid.uuid4())
            body = '시험1574 정말 친절하고 빠르게 연결해 주셨습니다 강력 추천합니다'
            for a in (a1, a2):
                r = psql(f"SET session_replication_role = replica; INSERT INTO deal_reviews (deal_id, author_id, target_id, rating, body) VALUES ('{deal}', '{a}', '{tgt}', 5, '{body}') RETURNING id")
                ids.append(r.split('\n')[-1])
            setting('mtr.review_watch', 'off', '1574')
            jb = call('POST', '/admin/jobs', {'job': 'mtr_hourly'}, TS)
            sc = call('POST', '/admin/mtr/reviews/scan', {}, TS)
            fl = psql(f"SELECT string_agg(id::text || ':' || score || ':' || array_to_string(signals, '+'), ',' ORDER BY id) FROM mtr_review_flags WHERE review_id IN ('{ids[0]}', '{ids[1]}')")
            ok('② 탐지 — 꺼져 있으면 매시간 작업은 건너뜀 · 「지금 보기」는 봄 · 같은 글 두 작성자 · 거래 당사자 아님 · 새 계정 → 둘 다 의심(거래 없음 + 비슷한 문장 + 새 계정 75점)',
               (jb.get('detail') or {}).get('review', {}).get('skipped') == 'OFF' and sc.get('scanned', 0) >= 2 and fl.count(':75:') == 2
               and 'NO_DEAL' in fl and 'SIMILAR' in fl and 'NEW_ACCOUNT' in fl, f"{(jb.get('detail') or {}).get('review')} {sc} {fl}")
            lst = call('GET', '/admin/mtr/reviews?state=OPEN', None, TS)
            mine = [r for r in (lst.get('rows') or []) if r.get('reviewId') in ids]
            fid = [r.get('id') for r in mine]
            det = call('GET', f'/admin/mtr/reviews/{fid[0]}', None, TS) if fid else {}
            ok('② 운영 목록 — 두 줄 · 작성자 가림(***) · 신호 이름 · 같은 대상 다른 후기 2',
               len(mine) == 2 and all('***' in (r.get('author') or '') for r in mine) and lst.get('signalNames', {}).get('SIMILAR') and len(det.get('others') or []) == 2,
               f"{len(mine)} {[r.get('author') for r in mine]} {len(det.get('others') or [])}")
            hd = call('POST', f'/admin/mtr/reviews/{fid[0]}/decide', {'verdict': 'FAKE', 'note': '같은 문장 두 계정', 'hide': True}, TS) if fid else {}
            fk = call('POST', f'/admin/mtr/reviews/{fid[0]}/decide', {'verdict': 'FAKE', 'note': '같은 문장 두 계정'}, TS) if fid else {}
            ag = call('POST', f'/admin/mtr/reviews/{fid[0]}/decide', {'verdict': 'OK', 'note': '다시 결정'}, TS) if fid else {}
            okd = call('POST', f'/admin/mtr/reviews/{fid[1]}/decide', {'verdict': 'OK', 'note': '본인 확인함'}, TS) if len(fid) > 1 else {}
            bv = call('POST', f'/admin/mtr/reviews/{fid[1]}/decide', {'verdict': 'MAYBE', 'note': '형식'}, TS) if len(fid) > 1 else {}
            ok('② 결정 — 거래 후기 가림 422 MTR_REVIEW_HIDE · 가짜 됨 · 다시 결정 409 · 문제없음 됨 · 틀린 결정 400',
               hd.get('_err') == 422 and hd.get('code') == 'MTR_REVIEW_HIDE' and fk.get('ok') is True and fk.get('state') == 'FAKE'
               and ag.get('_err') == 409 and okd.get('ok') is True and bv.get('_err') == 400,
               f"{hd.get('_err')} {hd.get('code')} {fk.get('state') or fk} {ag.get('_err')} {okd.get('state') or okd} {bv.get('_err')}")
            sc2 = call('POST', '/admin/mtr/reviews/scan', {}, TS)
            st = psql(f"SELECT string_agg(state, ',' ORDER BY id) FROM mtr_review_flags WHERE review_id IN ('{ids[0]}', '{ids[1]}')")
            still = psql(f"SELECT count(*) FROM deal_reviews WHERE id IN ('{ids[0]}', '{ids[1]}')")
            tr = psql(f"SELECT (items -> 4 -> 'basis' ->> 'reviews') FROM fn_mtr_trust('{tgt}')")
            ok('② 다시 보기 — 결정한 줄은 덮지 않음 · 후기는 지우지 않음(2) · 가짜 후기는 신뢰 점수 후기 수에서 빠짐(대상 계정이 없으면 빈 값)',
               sc2.get('scanned', 0) >= 2 and st == 'FAKE,OK' and still == '2' and not tr.startswith('!'), f"{st} {still} {tr}")
        finally:
            setting('mtr.review_watch', old['mtr.review_watch'] or 'off', '1574 되돌림')
            CLEAN()

    if ADMIN_WEB:
        r = admin_page('/#/mtr-reviews', lambda pg, seen: seen.update(n=pg.locator('[data-mtr-reviews]').count(), s=pg.locator('[data-mtr-review-state]').count(), b=pg.locator('[data-mtr-review-scan]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 가짜 후기 의심(상태 단추 3 · 지금 보기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 3 and seen.get('b') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
