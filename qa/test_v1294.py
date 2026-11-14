"""v10.294 (docs/415) — 사용자 웹 머리줄 안 읽은 공지 점(최근 30일)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1294.py

  ① (코드) /me/summary unreadNotices · /cart-count nt · 머리줄 📢 점(있을 때만 · 고객센터 › 공지사항) · 읽으면 다시 셈(sgb:notice-read) · 사전 · 문서 415 · 판 v10.294
  ② (API) 새 회원 공지 +1 · 31일 전 공지 · 남의 등급 · 관리자 · 예약 공지는 안 셈 · 펼치면 −1
  ③ (화면) 다른 공지는 읽은 것으로 두고 — 머리줄 점 1 → 고객센터 › 공지사항에서 펼치면 그 자리에서 사라짐 · 화면 오류 없음
  만든 공지 · 기록은 지움(두 번 돌아도 통과 · 시험이 넣은 「읽은 것으로」 기록은 first_at 2001-01-01 로 표시해 지움).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D415 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('415_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
verok = lambda n: tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, n)
MS, AD = rd('src/modules/me/me.service.ts'), rd('src/modules/identity/auth.dto.ts')
CC, UH = rd('site/src/app/cart-count/route.ts'), rd('site/src/components/common/UniHeader.tsx')
ND, CSS = rd('site/src/components/common/NoticeDetails.tsx'), rd('site/src/styles/site-head.css')
KO, EN = rd('site/src/i18n/messages/ko.json'), rd('site/src/i18n/messages/en.json')
ok('① 서버 — /me/summary unreadNotices(최근 30일 · 보이는 게시 중 · 안 펼친 것) · 응답 모양',
   'unreadNotices: await this.unreadNotices()' in MS and 'async unreadNotices()' in MS and "n.published_at > now() - interval '30 days'" in MS
   and 'unreadNotices!: number' in AD, f'{len(MS)}')
ok('① 화면 — /cart-count nt · 머리줄 📢 점(nt > 0 일 때만 · /support/notices) · 펼치면 다시 셈 · 점 모양 · 사전 ko · en · 문서 415 · 판 v10.294',
   'nt, ops, ...badges' in CC and 'st.nt > 0 &&' in UH and 'data-notice-dot={st.nt}' in UH and 'href="/support/notices"' in UH
   and "addEventListener('sgb:notice-read'" in UH and "new Event('sgb:notice-read')" in ND and '.sh-dot {' in CSS
   and '"noticeNew": "새 공지 {n}건"' in KO and '"noticeNew":' in EN and '머리줄' in D415 and verok(294), f'{VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()



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

stamp = str(int(time.time()))[-7:]
tag = f'U{stamp}X'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TB = login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    made = []
    unr = lambda: call('GET', '/me/summary', None, TB).get('unreadNotices')

    def mk(title, grades, at="now() - interval '1 minute'"):
        i = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at, is_pinned) VALUES (NULL, '시험 1294 {tag} {title}', '본문 {title}', ARRAY[{grades}]::text[], {at}, true) RETURNING id").splitlines()[0]
        made.append(i)
        return i
    try:
        u0 = unr()
        nN = mk('새 공지', "'MEMBER'")
        u1 = unr()
        mk('31일 전', "'MEMBER'", "now() - interval '31 days'"); mk('판매자', "'SELLER'"); mk('관리자', "'STAFF'"); mk('예약', "'MEMBER'", "now() + interval '2 days'")
        u2 = unr()
        rr = call('POST', f'/me/notices/{nN}/read', {}, TB)
        u3 = unr()
        ok('② API — /me/summary unreadNotices — 새 회원 공지 +1 · 31일 전 · 남의 등급 · 관리자 · 예약은 안 셈 · 펼치면 −1(펼침 응답과 같음)',
           isinstance(u0, int) and u1 == u0 + 1 and u2 == u1 and u3 == u0 and rr.get('unreadNotices') == u3, f'{u0} → {u1} → {u2} → {u3} · {rr}')

        if SITE:
            nD = mk('점', "'PUBLIC'")
            # 다른 안 읽은 공지는 「읽은 것으로」(first_at 2001-01-01 표시 · 끝나면 지움) — 점이 이 공지 하나로만 남게
            psql(f"""INSERT INTO notice_reads (notice_id, account_id, first_at, last_at)
                     SELECT n.id, '{acc}', '2001-01-01', '2001-01-01' FROM notices n
                      WHERE n.id <> '{nD}' AND n.published_at IS NOT NULL AND n.published_at <= now() AND n.published_at > now() - interval '30 days'
                        AND (n.ends_at IS NULL OR n.ends_at > now()) AND n.grades && array_remove(fn_notice_grades('{acc}'::uuid), 'STAFF')
                     ON CONFLICT DO NOTHING""")

            def run(b, seen, perr):
                seen['api'] = unr()
                ps = site_login(b, perr, 'buyer@x.com')
                ps.goto(SITE + '/support/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2500)
                seen['dot'] = ps.locator('[data-notice-dot]').count()
                seen['n'] = ps.locator('[data-notice-dot]').get_attribute('data-notice-dot') if seen['dot'] else None
                seen['href'] = ps.locator('[data-notice-dot]').get_attribute('href') if seen['dot'] else None
                ps.screenshot(path=os.path.join(HERE, 'v1294_dot.png'))
                box = f'[data-site-notice="{nD}"]'
                if ps.locator(box).count():
                    ps.click(f'{box} summary'); ps.wait_for_timeout(3000)
                seen['dot2'] = ps.locator('[data-notice-dot]').count()
                ps.goto(SITE + '/', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2000)
                seen['dot3'] = ps.locator('[data-notice-dot]').count()
            r = ui(run)
            if r is None:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 머리줄 📢 점 1(고객센터 › 공지사항으로) → 펼치면 그 자리에서 사라짐 · 메인에서도 없음 · 화면 오류 없음',
                   seen.get('api') == 1 and seen.get('dot') == 1 and seen.get('n') == '1' and seen.get('href') == '/support/notices'
                   and seen.get('dot2') == 0 and seen.get('dot3') == 0 and not perr, f'{seen} · {perr[:2]}')
    finally:
        psql(f"DELETE FROM notice_reads WHERE account_id = '{acc}' AND first_at = '2001-01-01'")
        for x in made:
            psql(f"DELETE FROM notice_reads WHERE notice_id = '{x}'")
            psql(f"DELETE FROM notices WHERE id = '{x}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
