"""v10.304 (docs/426) — 약관 초안 ↔ 개발 원문 비교 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1304.py

  ① (코드) TERM_SOURCES(HLT_SELLER 1.0 → 400_ · PRIVACY 1.1 → 401_) · 「## 4. 전문」 ````markdown 칸 · GET terms/sources · terms/:code/source(404) ·
     화면 「개발 원문과 비교」 · 비교 기준 셋째 단추 · screens.json · 영어 · 문서 426 · 판 v10.304
  ② (API) sources 에 두 판 · 원문 전문 = D207 이 넣은 글(킷 마이그레이션 SQL 안 글과 같음) · 없는 판 404 · ADMIN 403 · 읽기만(약관 표 그대로)
  ③ (화면) 관 관리 › 「약관」 › HLT_SELLER 1.0 「고치기」 → 「개발 원문과 비교」 → 기준 source:400 → 본문 한 줄 고치면 「이 글에만 있는 줄」 1 · 저장 안 함
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
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
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D426 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('426_')), '')
TS_, TC = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.controller.ts')
TD, TP = rd('src/modules/catalog/terms.dto.ts'), rd('web/src/app/admin/TermsPanel.tsx')
SJ, ST = rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts')
M7 = rd('prisma/migrations/D207_terms_seller_privacy_drafts/migration.sql')
ok('① 서버 — TERM_SOURCES 두 판 · 「## 4. 전문」 ````markdown 칸만 · 킷 docs 폴더(앱 폴더 기준) · sources · source 404 · DTO · 읽기만',
   "{ code: 'HLT_SELLER', version: '1.0', prefix: '400_' }" in TS_ and "{ code: 'PRIVACY', version: '1.1', prefix: '401_' }" in TS_
   and "doc.indexOf('## 4. 전문')" in TS_ and "join(process.cwd(), 'docs')" in TS_ and "throw new NotFound('이 약관 판의 개발 원문이 없습니다.')" in TS_
   and "@Get('terms/sources')" in TC and "@Get('terms/:code/source')" in TC and TC.find("@Get('terms/sources')") < TC.find("@Put('terms/:code')")
   and 'class TermSourceDto extends TermSourceItemDto' in TD and 'UPDATE' not in TS_[TS_.find('sources() {'):TS_.find('/** 관리자용.')], '')
ok('① 화면 · 연결 — 「개발 원문과 비교」 · 기준 셋째 단추 · source:400 · screens.json 두 API · 영어 · 문서 426 · 판 v10.304',
   "useApi<{ code: string; version: string; file: string }[]>('/admin/terms/sources')" in TP and 'data-term-src-btn' in TP and 'data-term-diff-source' in TP
   and '`source:${ed.src!.file.slice(0, 3)}`' in TP and "'개발 원문에만 있는 줄'" in TP and '"GET /admin/terms/sources"' in SJ and '"GET /admin/terms/{code}/source"' in SJ
   and '"이 약관 판의 개발 원문이 없습니다.":' in ST and '개발 원문' in D426 and 'docs/400' in D426
   and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 304), VER)


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
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


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    # ADMIN(최고 관리자 아님) — 시험 계정을 만들어 씀(남겨 두어도 두 번째 실행에 지장 없음)
    stamp = str(int(time.time()))[-7:]
    em = f't1304a{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1304', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING")
    consent_ok.agree(em, PW)
    TA = call('POST', '/auth/login', {'email': em, 'password': PW}).get('accessToken')
    before = psql("SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms")

    sr = call('GET', '/admin/terms/sources', None, TS)
    keys = sorted(f"{x.get('code')}:{x.get('version')}:{(x.get('file') or '')[:4]}" for x in sr) if isinstance(sr, list) else sr
    s1 = call('GET', '/admin/terms/HLT_SELLER/source?version=1.0', None, TS)
    s2 = call('GET', '/admin/terms/PRIVACY/source?version=1.1', None, TS)
    want1 = (re.search(r'\$D207S\$(.*?)\$D207S\$', M7, re.S) or [None, ''])[1].strip()
    want2 = (re.search(r'\$D207P\$(.*?)\$D207P\$', M7, re.S) or [None, ''])[1].strip()
    ok('② sources 두 판(400_ · 401_) · 원문 전문 = D207 이 넣은 글(입점 약관 · 처리방침 1.1) · 문서 머리말 · 표는 빠짐',
       keys == ['HLT_SELLER:1.0:400_', 'PRIVACY:1.1:401_'] and (s1.get('body') or '').strip() == want1 and want1.startswith('# 소개몰 입점(판매자) 이용약관')
       and (s2.get('body') or '').strip() == want2 and len(want2) > 1000 and '게시용 완성본' not in (s1.get('body') or '') and s1.get('file', '').startswith('400_'),
       f"{keys} · {len(s1.get('body') or '')}/{len(want1)} · {len(s2.get('body') or '')}/{len(want2)}")
    n1 = call('GET', '/admin/terms/SERVICE/source?version=1.0', None, TS)
    n2 = call('GET', '/admin/terms/HLT_SELLER/source?version=9.9', None, TS)
    a1 = call('GET', '/admin/terms/sources', None, TA)
    a2 = call('GET', '/admin/terms/HLT_SELLER/source?version=1.0', None, TA)
    after = psql("SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms")
    ok('② 원문 없는 판 404 · ADMIN 403 · 읽기만(약관 표 그대로)',
       n1.get('_err') == 404 and n2.get('_err') == 404 and a1.get('_err') == 403 and a2.get('_err') == 403 and before == after and before and not before.startswith('!'),
       f"{n1.get('_err')} {n2.get('_err')} · {a1.get('_err')} {a2.get('_err')} · {before == after}")

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                row = pg.locator('[data-term-row="HLT_SELLER:1.0"]')
                seen['row'] = row.count()
                if row.count():
                    row.locator('[data-term-edit]').first.click(); pg.wait_for_timeout(800)
                    ed = pg.locator('[data-term-editor="HLT_SELLER:1.0"]')
                    seen['srcBtn'] = ed.locator('[data-term-src-btn]').count()
                    ed.locator('[data-term-src-btn]').click(); pg.wait_for_timeout(1500)
                    dv = ed.locator('[data-term-diff]')
                    seen['base'] = dv.get_attribute('data-term-diff-base') if dv.count() else ''
                    seen['n0'] = dv.get_attribute('data-term-diff') if dv.count() else ''
                    seen['threeBtn'] = ed.locator('[data-term-diff-source]').count()
                    tx = ed.locator('[data-term-text]')
                    tx.fill(tx.input_value() + '\n시험 1304 한 줄'); pg.wait_for_timeout(600)
                    seen['count'] = ed.locator('[data-term-diff-count]').get_attribute('data-term-diff-count') if ed.locator('[data-term-diff-count]').count() else ''
                    seen['plus'] = '시험 1304 한 줄' in (ed.locator('[data-term-diff-col="plus"]').inner_text() if ed.locator('[data-term-diff-col="plus"]').count() else '')
                    ed.locator('[data-term-diff-orig]').click(); pg.wait_for_timeout(400)
                    seen['origBase'] = ed.locator('[data-term-diff]').get_attribute('data-term-diff-base')
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        after2 = psql("SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms")
        ok('③ 화면 — HLT_SELLER 1.0 「고치기」 → 「개발 원문과 비교」 → 기준 source:400 · 기준 단추 셋 · 한 줄 더하면 「이 글에만 있는 줄」에 보임 · 기준 바꾸기 · 저장 안 함',
           seen.get('row') == 1 and seen.get('srcBtn') == 1 and seen.get('base') == 'source:400' and seen.get('threeBtn') == 1
           and str(seen.get('count') or '').endswith('|1') and seen.get('plus') is True and seen.get('origBase') == 'orig' and after2 == before, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
