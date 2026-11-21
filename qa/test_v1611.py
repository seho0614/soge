"""v10.611 (docs/753) ㉗ 1:1 문의 사진 첨부 — 내 문의에 사진 더 붙이기 · 운영 답변 사진 · 운영 한 건 화면 미리 보기
  ① (코드) 기존 파일 용도 INQUIRY_ATTACHMENT 재사용 · 그림만 · 6장 · 회원 바이트 API · 운영도 올림 · 스위치 · 화면 · 화면 목록 · SQL · 문서 753 · 판
  ② (API · DB) 꺼짐 422 · 켬 → 회원 1장 · 4장 400 · 남의 문의 404 · 운영이 남의 파일 422 · 답변 사진 · 회원이 답변 사진 바이트 · 닫힌 문의 409 · DB 고치기 막음
  ③ (화면) 1:1 문의 한 건 · 사진 미리 보기 2
  (두 번 돌아도 통과 — 「시험1611-」 문의 · 붙인 줄은 replica 로 지움 · 올린 파일은 replica 로 DELETED · 설정은 되돌림)
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



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
import base64, hashlib
IP, CT, FS = rd('src/modules/bzx/inquiry-photos.ts'), rd('src/modules/bzx/bzx.controller.ts'), rd('src/modules/file/file.service.ts')
UI, DK = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SH, SC2 = rd('site/src/app/support/history/page.tsx'), rd('site/src/components/bzx/InquiryPhotos.tsx')
ok('① 코드 — 기존 파일 용도 INQUIRY_ATTACHMENT 재사용(새 용도 없음) · 그림만 · 문의마다 6장 · 회원 바이트는 이 API(fn_file_can_read 안 고침) · 운영도 올림 · 스위치',
   all(f in IP for f in ("purpose = 'INQUIRY_ATTACHMENT'", "'image/jpeg', 'image/png'", 'INQ_PHOTO_MAX = 6', 'storageFromEnv().open(', "'bzx.inquiry_photos'", "'INQUIRY_CLOSED'"))
   and "@Controller('api/v1/me/bzx')" in CT and "@Get('inquiries/:id/photos/:fileId')" in CT
   and "INQUIRY_ATTACHMENT: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN']" in FS, f"{len(IP)}")
ok('① 화면 — 운영 1:1 문의 한 건에 사진 미리 보기(BzxInquiryPhotos) · 내 문의 내역 「사진」(InquiryPhotos) · 화면 목록 · SQL · 문서 753 · 판',
   'export function BzxInquiryPhotos' in UI and '<BzxInquiryPhotos id={id}' in DK and '<InquiryPhotos id={r.id}' in SH and '/api/v1/me/bzx/inquiries/' in SC2
   and '"SB-ADM-BZX-031"' in SJ and '"SB-HOM-BZX-010"' in SJ and migr_has('CREATE TABLE IF NOT EXISTS public.bzx_inquiry_files') and migr_has("('bzx.inquiry_photos', 'off'")
   and 'INQUIRY_ATTACHMENT' in doc('753_') and VT >= (10, 611), VER)

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
def up_png(tok, tag):
    data = PNG + f'{tag}{STAMP}{time.time()}'.encode()
    r = call('POST', '/files', {'purpose': 'INQUIRY_ATTACHMENT', 'name': f'p{tag}.png', 'contentType': 'image/png', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, tok)
    if not r.get('fileId'):
        return None
    url = r.get('uploadUrl') or ''
    if url.startswith('/'):
        url = re.sub(r'/api/v1/?$', '', API) + url
    hd = dict(r.get('headers') or {}); hd.setdefault('Content-Type', 'image/png')
    try:
        urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=r.get('method') or 'PUT'), timeout=60).read()
    except Exception:
        return None
    c = call('POST', f"/files/{r['fileId']}/complete", {}, tok)
    return r['fileId'] if not c.get('_err') else None
def raw(p, tok):
    try:
        rr = urllib.request.urlopen(urllib.request.Request(API + p, headers={'Authorization': 'Bearer ' + tok}), timeout=60)
        return rr.status, rr.headers.get('Content-Type'), rr.read()[:8]
    except urllib.error.HTTPError as e:
        return e.code, None, b''

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW); consent_ok.agree('seller@x.com', PW)
    TS, TB, TO = login('admin@x.com'), login('buyer@x.com'), login('seller@x.com')
    old = getset('bzx.inquiry_photos')
    files = []
    def clean():
        psql("SET session_replication_role = replica; "
             "DELETE FROM bzx_inquiry_files WHERE inquiry_id IN (SELECT id FROM inquiries WHERE title LIKE '시험1611-%'); "
             "DELETE FROM inquiries WHERE title LIKE '시험1611-%';"
             + (f" UPDATE files SET status = 'DELETED' WHERE id IN ({','.join(repr(f) for f in files)});" if files else ''))
    clean()
    try:
        cat = psql("SELECT code FROM code_labels WHERE domain = 'inquiry.category' AND is_active ORDER BY sort_order LIMIT 1")
        q = call('POST', '/inquiries', {'category': cat, 'title': f'시험1611-{STAMP}', 'body': '시험 1611 사진 첨부 문의입니다.'}, TB)
        iid = str(q.get('id') or '')
        setting('bzx.inquiry_photos', 'off', '1611')
        f1 = up_png(TB, 'm1'); files += [f1] if f1 else []
        off = call('POST', f'/me/bzx/inquiries/{iid}/photos', {'fileIds': [f1]}, TB)
        setting('bzx.inquiry_photos', 'on', '1611')
        a1 = call('POST', f'/me/bzx/inquiries/{iid}/photos', {'fileIds': [f1]}, TB)
        many = call('POST', f'/me/bzx/inquiries/{iid}/photos', {'fileIds': [f1, f1, f1, f1]}, TB)
        other = call('GET', f'/me/bzx/inquiries/{iid}/photos', None, TO)
        ok('② 회원 — 꺼짐 422 BZX_OFF · 켬 → 내 문의에 사진 1장 · 한 번에 4장 400 · 남의 문의 404',
           len(iid) == 36 and bool(f1) and off.get('_err') == 422 and off.get('code') == 'BZX_OFF' and a1.get('added') == 1 and many.get('_err') == 400 and other.get('_err') == 404,
           f"{iid} {f1} {off.get('code')} {a1.get('added')} {a1.get('message')} {many.get('_err')} {other.get('_err')}")
        fs = up_png(TS, 's1'); files += [fs] if fs else []
        steal = call('POST', f'/admin/bzx/inquiries/{iid}/photos', {'fileIds': [f1]}, TS)
        s1 = call('POST', f'/admin/bzx/inquiries/{iid}/photos', {'fileIds': [fs]}, TS)
        mine = call('GET', f'/me/bzx/inquiries/{iid}/photos', None, TB)
        sides = sorted(x.get('side') for x in mine.get('items') or [])
        st, ctp, head = raw(f'/me/bzx/inquiries/{iid}/photos/{fs}', TB)
        st2, _, _ = raw(f'/me/bzx/inquiries/{iid}/photos/{fs}', TO)
        adm = call('GET', f'/admin/bzx/inquiries/{iid}/photos', None, TS)
        ok('② 운영 — 남이 올린 파일 붙이기 422 · 답변 사진 붙임 · 회원 목록에 MEMBER · STAFF · 회원이 답변 사진 바이트(image/png) · 남은 404 · 운영 목록 2',
           bool(fs) and steal.get('_err') == 422 and s1.get('added') == 1 and sides == ['MEMBER', 'STAFF'] and st == 200 and ctp == 'image/png' and head[:4] == b'\x89PNG' and st2 == 404
           and len(adm.get('items') or []) == 2 and adm.get('on') is True,
           f"{fs} {steal.get('code')} {s1.get('added')} {s1.get('message')} {sides} {st} {ctp} {st2} {len(adm.get('items') or [])}")
        psql(f"UPDATE inquiries SET status = 'CLOSED' WHERE id = '{iid}'")
        f2 = up_png(TB, 'm2'); files += [f2] if f2 else []
        cl = call('POST', f'/me/bzx/inquiries/{iid}/photos', {'fileIds': [f2]}, TB)
        g = psql(f"UPDATE bzx_inquiry_files SET side = 'STAFF' WHERE inquiry_id = '{iid}'")
        ok('② 닫힌 문의 409 INQUIRY_CLOSED · DB 가 붙인 줄 고치기를 막음', cl.get('_err') == 409 and cl.get('code') == 'INQUIRY_CLOSED' and 'BZX_INQ_PHOTO' in g, f"{cl.get('code')} {g[-60:]}")
        if ADMIN_WEB:
            psql(f"UPDATE inquiries SET status = 'OPEN' WHERE id = '{iid}'")
            def chk(pg, seen):
                pg.fill('input[name=inq-q]', f'시험1611-{STAMP}'); pg.click('[data-inquiry-q-go]'); pg.wait_for_timeout(2500)
                pg.locator(f'[data-inquiry-open="{iid}"]').first.click()
                pg.wait_for_selector('[data-bzx-inq-photos]', timeout=30000); pg.wait_for_timeout(1500)
                seen['n'] = pg.locator('[data-bzx-inq-photos]').get_attribute('data-bzx-inq-photos')
                seen['thumb'] = pg.locator('[data-bzx-inq-thumb]').count()
            res3 = admin_page('/#/inquiries', chk)
            if res3 is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res3
                ok('③ 화면 — 1:1 문의 한 건 · 사진 미리 보기 2 · 화면 오류 없음', seen.get('n') == '2' and seen.get('thumb') == 2 and not perr, f"{seen} {perr[:2]}")
    finally:
        clean()
        setting('bzx.inquiry_photos', old or 'off', '1611 되돌림')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
