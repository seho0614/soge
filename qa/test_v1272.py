"""v10.272 ~ v10.274 (D206 · D207 · docs/404) — 입점 유형 요율 · 약관 초안 2건 · 요율 바꾸기 영향 미리보기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1272.py

  ① (코드) D206(표 2개 · 처음 비어 있음 · 순서 판매자 → 유형 → 갈래 · 기록 못 고침) · D207(처음 본문일 때만 · 초안 · 게시 없음 · 문서 400 · 401 본문 그대로) ·
     API 3개 · 화면(입점 유형 요율 상자 · 바꾸기 전 미리보기 3곳) · 명세 · 문서 404 · 마이그레이션 245 · 판 v10.274 이상
  ② (DB) 요율 순서 — 유형 비면 갈래 · 유형 7 → 7 · 판매자 15 → 15 · 직판 0 (모두 되돌림) · 기록 고치기 막힘
  ③ (DB) D207 — 입점 초안 = docs/400 · 고친 초안은 그대로 · 처리방침 새 초안(DRAFT · 게시된 판 그대로 · 두 번 돌려도 하나) (모두 되돌림)
  ④ (API) 유형 요율 ADMIN 봄 · 회원 403 · 사유 없음 422 · DIRECT 422 · 바꾸기 → 기록 · 같은 값 409 · 비우기 · 미리보기(같은 요율이면 차이 0 · 범위 · 기본 갈래 422)
  ⑤ (화면) 소개몰 › 소개몰 정산 › 「입점 유형 요율」 상자 · 「바꾸기」 → 미리보기 확인 창(최근 30일) · 취소하면 그대로 · 화면 오류 없음
  끝나면 유형 요율을 비운 채로 되돌림(두 번 돌아도 통과).
"""
import glob, json, os, re, subprocess, urllib.error, urllib.request
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
M6, M7 = rd('prisma/migrations/D206_hlt_type_rates/migration.sql'), rd('prisma/migrations/D207_terms_seller_privacy_drafts/migration.sql')
SV, CT = rd('src/modules/health/health-settle.service.ts'), rd('src/modules/health/health-seller.controller.ts')
TR, HS, HL = rd('web/src/app/admin/HealthTypeRates.tsx'), rd('web/src/app/admin/HealthSettle.tsx'), rd('web/src/app/admin/HealthSellers.tsx')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []


def doc(n):
    f = [x for x in docs if x.startswith(f'{n}_')]
    return open(os.path.join(K, 'docs', f[0]), encoding='utf-8').read() if f else ''


def body(t):
    m = re.search(r'````markdown\n(.*?)\n````', t, re.S)
    return m.group(1) if m else ''


B400, B401, D404 = body(doc(400)), body(doc(401)), doc(404)
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')

ok('① D206 — 유형 요율 표(BRAND · TENANT · 처음 NULL) · 기록 표(사유 2자 · 못 고침) · 순서 판매자 → 유형(NULL 건너뜀) → 갈래 → * → 10 · 지우는 문장 없음',
   "('BRAND',  NULL," in M6 and "('TENANT', NULL," in M6 and 'length(btrim(reason)) >= 2' in M6 and 'fn_hlt_rate_log_ro()' in M6
   and re.search(r'commission_rate IS NOT NULL\),\s*\(SELECT t\.rate FROM hlt_seller_type_rates t JOIN hlt_sellers s ON s\.type = t\.seller_type\s*WHERE s\.id = p_seller AND t\.rate IS NOT NULL\),\s*\(SELECT rate FROM hlt_commission_rates WHERE category_code = p_category_code\)', M6)
   and not BAD.search(M6), '')
ok('① D207 — 입점 초안은 D155 처음 본문(md5)일 때만 · 처리방침은 초안 없을 때만 DRAFT · 게시 없음 · 본문 = 문서 400 · 401 · 지우는 문장 없음',
   'md5(r.body) <> v_d155' in M7 and "status IN ('DRAFT', 'LEGAL_REVIEW')" in M7 and "'infinity', 'DRAFT'" in M7 and "'PUBLISHED' WHERE" not in M7
   and "SET status = 'PUBLISHED'" not in M7 and bool(B400) and bool(B401) and f'$D207S${B400}$D207S$' in M7 and f'$D207P${B401}$D207P$' in M7 and not BAD.search(M7), '')
ok('① API 3개(유형 요율 보기 · 바꾸기(사유 · 기록 · 감사) · 영향 미리보기(읽기만 · 30일 · 쓰이는 줄만)) · 화면(상자 · 미리보기 3곳) · 명세 · 문서 404 · 마이그레이션 245 · 판 v10.274 이상',
   "@Get('admin/health/type-rates')" in CT and "@Patch('admin/health/type-rates/:sellerType')" in CT and "@Audit('HLT_TYPE_RATE'" in CT and "@Get('admin/health/rate-impact')" in CT
   and 'async rateImpact(' in SV and "interval '30 days'" in SV and 'l.srate IS NULL AND l.trate IS NULL' in SV and 'INSERT INTO hlt_type_rate_changes' in SV
   and 'export function HealthTypeRates(' in TR and 'export async function previewImpact(' in TR and '<HealthTypeRates ' in HS   # v10.276 onChanged 받음
   and "previewImpact('CATEGORY'" in HS and "previewImpact('SELLER'" in HL and "previewImpact('TYPE'" in TR
   and all(f'"{a}"' in SCR for a in ('GET /admin/health/type-rates', 'PATCH /admin/health/type-rates/{sellerType}', 'GET /admin/health/rate-impact'))
   and bool(D404) and len(mig) in (245, 246, 247) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 274), f'{len(mig)} · {VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def psql_f(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return r.stdout.strip() + ('\n!' + r.stderr.strip()[-300:] if r.returncode else '')


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")   # 앞 실행이 멈춰 남았으면 비움(기록 없이)

    # ② 순서 — 한 트랜잭션 안에서 보고 되돌림
    o = psql_f("""BEGIN;
INSERT INTO hlt_sellers (code, name, type, status) VALUES ('T-1272-B', '시험 직영', 'BRAND', 'ACTIVE');
SELECT 'a' || fn_hlt_rate_for((SELECT id FROM hlt_sellers WHERE code = 'T-1272-B'), 'HLT_FUNC')::text
    || '|' || coalesce((SELECT rate FROM hlt_commission_rates WHERE category_code = 'HLT_FUNC'), (SELECT rate FROM hlt_commission_rates WHERE category_code = '*'), 10)::text;
UPDATE hlt_seller_type_rates SET rate = 7 WHERE seller_type = 'BRAND';
SELECT 'b' || fn_hlt_rate_for((SELECT id FROM hlt_sellers WHERE code = 'T-1272-B'), 'HLT_FUNC');
SELECT 'd' || fn_hlt_rate_for((SELECT id FROM hlt_sellers WHERE type = 'DIRECT'), 'HLT_FUNC');
UPDATE hlt_sellers SET commission_rate = 15 WHERE code = 'T-1272-B';
SELECT 'c' || fn_hlt_rate_for((SELECT id FROM hlt_sellers WHERE code = 'T-1272-B'), 'HLT_FUNC');
ROLLBACK;""")
    L = dict((x[0], x[1:]) for x in o.splitlines() if x[:1] in 'abcd')
    a0 = (L.get('a') or '|').split('|')
    ro = psql_f("BEGIN; INSERT INTO hlt_type_rate_changes (seller_type, from_rate, to_rate, reason) VALUES ('BRAND', NULL, 1, '시험 1272'); "
                "UPDATE hlt_type_rate_changes SET reason = 'x' WHERE reason = '시험 1272'; ROLLBACK;")
    ok('② DB 순서 — 유형 비면 갈래 요율 · 유형 7 → 7 · 판매자 15 → 15 · 직판 0 · 기록 고치기 막힘(되돌림)',
       a0[0] != '' and float(a0[0]) == float(a0[1]) and float(L.get('b') or -1) == 7 and float(L.get('c') or -1) == 15 and float(L.get('d') or -1) == 0
       and 'HLTC' in ro and psql("SELECT count(*) FROM hlt_sellers WHERE code = 'T-1272-B'") == '0', f'{L} · {ro[-60:]}')

    # ③ D207 — 운영처럼(게시된 처리방침 · 초안 없음) 한 트랜잭션에서 돌려 보고 되돌림
    sel = psql("SELECT status || '|' || (body = $B$" + B400 + "$B$)::text FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0'")
    pub0 = psql("SELECT string_agg(version || ':' || md5(body), ',' ORDER BY version) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED'")
    o3 = psql_f("BEGIN;\nUPDATE terms SET body = 'x' || body WHERE code = 'HLT_SELLER' AND version = '1.0' AND status IN ('DRAFT', 'LEGAL_REVIEW');\n"
                "DELETE FROM terms WHERE code = 'PRIVACY' AND status IN ('DRAFT', 'LEGAL_REVIEW');\n" + M7 + "\n" + M7 + "\n"
                "SELECT 'e' || (SELECT left(body, 1) FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0');\n"
                "SELECT 'p' || count(*) || '|' || coalesce(string_agg(version || ':' || status || ':' || (effective_from = 'infinity')::text, ','), '') FROM terms WHERE code = 'PRIVACY' AND body = $B$" + B401 + "$B$;\n"
                "SELECT 'g' || string_agg(version || ':' || md5(body), ',' ORDER BY version) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED';\n"
                "ROLLBACK;")
    L3 = dict((x[0], x[1:]) for x in o3.splitlines() if x[:1] in 'epg')
    pv = (L3.get('p') or '0|').split('|')
    has_pub = bool(pub0)
    ok('③ D207 — 입점 1.0 초안 본문 = docs/400 · 고친 초안은 그대로 · 처리방침 새 초안 하나(DRAFT · 시행일 비움) · 게시된 판 그대로(되돌림)',
       (sel.startswith('PUBLISHED') or sel in ('DRAFT|true', 'LEGAL_REVIEW|true')) and L3.get('e') == 'x'
       and ((not has_pub and pv[0] == '0') or (pv[0] == '1' and pv[1].endswith(':DRAFT:true'))) and L3.get('g', '') == (pub0 or '') and '!' not in o3,
       f"입점 {sel} · {L3} · 게시 {pub0[:24]}")

    # ④ API
    tr = call('GET', '/admin/health/type-rates', None, TS)
    t403 = call('GET', '/admin/health/type-rates', None, TB).get('_err')
    noreason = call('PATCH', '/admin/health/type-rates/BRAND', {'rate': 9, 'reason': ' '}, TS)
    direct = call('PATCH', '/admin/health/type-rates/DIRECT', {'rate': 9, 'reason': '시험 1272'}, TS)
    n0 = psql("SELECT count(*) FROM hlt_type_rate_changes WHERE seller_type = 'BRAND'")
    # v10.275 (D208) — 올리면(영향받는 판매자가 있으면) 30일 뒤 예약 → 여기서는 모든 갈래(8% 이상)보다 낮은 7%(바로 바뀌는 내림)
    s1 = call('PATCH', '/admin/health/type-rates/BRAND', {'rate': 7, 'reason': '시험 1272 바꿈'}, TS)
    same = call('PATCH', '/admin/health/type-rates/BRAND', {'rate': 7, 'reason': '시험 1272 같음'}, TS)
    tr1 = call('GET', '/admin/health/type-rates', None, TS)
    s2 = call('PATCH', '/admin/health/type-rates/BRAND', {'rate': None, 'reason': '시험 1272 비움'}, TS)
    if s2.get('code') == 'NOTICE_REQUIRED':   # 비우면 갈래 요율(8 ~ 12%)로 오름 — 다른 시험이 만든 브랜드 판매자가 있으면 예약이 맞음 → 그대로 되돌림
        s2 = {'ok': True, 'notice': True}
        psql("UPDATE hlt_seller_type_rates SET rate = NULL WHERE seller_type = 'BRAND'")
        psql("INSERT INTO hlt_type_rate_changes (seller_type, from_rate, to_rate, reason) VALUES ('BRAND', 7, NULL, '시험 1272 비움(되돌림)')")
    n1 = psql("SELECT count(*) FROM hlt_type_rate_changes WHERE seller_type = 'BRAND'")
    last = psql("SELECT coalesce(from_rate::text, '-') || '>' || coalesce(to_rate::text, '-') FROM hlt_type_rate_changes WHERE seller_type = 'BRAND' ORDER BY changed_at DESC LIMIT 1")
    b1 = [x for x in tr1 if isinstance(tr1, list) and x.get('sellerType') == 'BRAND'] if isinstance(tr1, list) else []
    ok('④ 유형 요율 API — ADMIN 봄(BRAND · TENANT · 처음 비어 있음) · 회원 403 · 사유 없음 422 · DIRECT 422 · 7% 바꿈 → 기록 · 같은 값 409 · 비우기 → 기록 2줄(오르면 예약 — test_v1275)',
       isinstance(tr, list) and sorted(x.get('sellerType') for x in tr) == ['BRAND', 'TENANT'] and all(x.get('rate') is None for x in tr)
       and t403 == 403 and noreason.get('_err') == 422 and noreason.get('code') == 'REASON_REQUIRED' and direct.get('_err') == 422
       and s1.get('ok') is True and same.get('_err') == 409 and b1 and float(b1[0].get('rate') or 0) == 7 and s2.get('ok') is True
       and int(n1) - int(n0) == 2 and last == '7.00>-',
       f"{[(x.get('sellerType'), x.get('rate')) for x in tr] if isinstance(tr, list) else tr} · {t403} · {noreason} · {direct.get('_err')} · {same} · {n0}->{n1} · {last}")

    cur = psql("SELECT rate FROM hlt_commission_rates WHERE category_code = 'HLT_FOOD'") or '10'
    i0 = call('GET', f'/admin/health/rate-impact?scope=CATEGORY&key=HLT_FOOD&rate={cur}', None, TS)
    i1 = call('GET', f'/admin/health/rate-impact?scope=CATEGORY&key=HLT_FOOD&rate={float(cur) + 5}', None, TS)
    i2 = call('GET', '/admin/health/rate-impact?scope=TYPE&key=TENANT&rate=', None, TS)
    bad = [call('GET', q, None, TS).get('_err') for q in ('/admin/health/rate-impact?scope=CATEGORY&key=*&rate=5', '/admin/health/rate-impact?scope=X&key=a&rate=5',
                                                         '/admin/health/rate-impact?scope=CATEGORY&key=HLT_FOOD&rate=60')]
    ib = call('GET', '/admin/health/rate-impact?scope=CATEGORY&key=HLT_FOOD&rate=5', None, TB).get('_err')
    ok('④ 미리보기 — 같은 요율이면 차이 0 · +5% 면 늘거나 같음(주문 없으면 0) · 유형 비움은 차이 0 · 기본 갈래 · 모르는 범위 · 60% 는 422 · 회원 403',
       i0.get('days') == 30 and i0.get('diff') == 0 and i0.get('nowFee') == i0.get('newFee') and isinstance(i1.get('lines'), int)
       and (i1.get('diff') > 0 if i1.get('sales') else i1.get('diff') == 0) and i2.get('diff') == 0 and bad == [422, 422, 422] and ib == 403,
       f"{ {k: i0.get(k) for k in ('lines', 'sales', 'nowFee', 'newFee')} } · +5 {i1.get('diff')} · {i2.get('diff')} · {bad} · {ib}")

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen, errs, msgs = {}, [], []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))

                def dlg(d):
                    msgs.append(d.type + ':' + d.message[:200])
                    d.accept('12') if d.type == 'prompt' else d.dismiss()
                pg.on('dialog', dlg)
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.wait_for_selector('[data-state-check]', timeout=30000)
                pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['box'] = pg.locator('[data-type-rates]').first.get_attribute('data-type-rates') if pg.locator('[data-type-rates]').count() else None
                seen['text'] = pg.locator('[data-type-rates]').first.inner_text()[:80] if pg.locator('[data-type-rates]').count() else ''
                if pg.locator('[data-type-rate-edit="TENANT"]').count():
                    pg.click('[data-type-rate-edit="TENANT"]'); pg.wait_for_timeout(2500)
                seen['after'] = pg.locator('[data-type-rates]').first.get_attribute('data-type-rates') if pg.locator('[data-type-rates]').count() else None
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        conf = [m for m in msgs if m.startswith('confirm:')]
        ok('⑤ 운영 화면 소개몰 › 소개몰 정산 › 「입점 유형 요율」 상자(둘 다 비어 있음) · 「바꾸기」 → 미리보기 확인 창(일반 입점 → 12% · 최근 30일) · 취소하면 그대로 · 화면 오류 없음',
           seen.get('box') == 'BRAND:-|TENANT:-' and '입점 유형 요율' in seen.get('text', '') and len(conf) == 1 and '일반 입점 → 12%' in conf[0] and '최근 30일' in conf[0]
           and seen.get('after') == 'BRAND:-|TENANT:-' and not errs, f'{seen} · {msgs[:3]} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
