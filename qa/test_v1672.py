"""v10.672 ~ 674 (D316 · docs/797) 관 현황판 · 블록 끌어 놓기 · 공통 조각
  ① (코드) D316 · 현황 API · 현황판 · 끌어 놓기(⠿ · Alt + ↑ ↓) · 조각 서버(펼침 · source · 조각 안 조각 막음) · 화면 · HTML 왕복 · 영어 · screens.json
  ② (DB) 조각 이름 41자 · 블록 11개 막힘(되돌림)
  ③ (API) 현황 7일 7줄 · 틀린 기간은 30 · 조각 만들기 · 같은 이름 409 · 조각 안 조각 422 · MNY 시험 페이지에 조각 블록 → 게시 판은 펼친 블록 · 초안은 조각 자리 · 「초안 다름」 아님
       · 조각 고치면 게시 판 그대로 · 「초안 다름」도 아님(source 비교) · 쓰는 페이지 1 · 지우기 422 · 조각 블록 빼고 지우기 — 끝나면 지움
  ④ 문서 797 · 판
  (두 번 돌아도 통과 — 이름 · 주소에 시각)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
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

# v10.705 (docs/813) 관이 열려 있으면 관 페이지를 만들거나 고칠 수 없음 → 고치는 부르기만 소개장터(MNY)를 잠깐 닫았다 다시 엶(이 시험은 늘 혼자 · reg_solo_force)
_call_open = call


def call(m_, p, b=None, t=None):
    if m_ != 'GET' and re.match(r'^/admin/(gwan-pages|gwans/MNY/pages|gwan-fragments/\d+/republish)', p):
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")
        try:
            return _call_open(m_, p, b, t)
        finally:
            psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
    return _call_open(m_, p, b, t)



def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def _up():   # 서버 · DB 가 응답할 때만 ② · ③(미리 검사는 닿지 않는 주소로 돎)
    try:
        urllib.request.urlopen(API + '/health', timeout=5); api = True
    except Exception:
        api = False
    return api, bool(DB) and psql('SELECT 1') == '1'


API_UP, DB_UP = _up() if API and DB else (False, False)
VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

# ── ① 코드 ─────────────────────────────────────────────────────────────
M6 = rd('prisma/migrations/D316_gwan_stats_fragments/migration.sql')
ok('① D316 — 조각 표(이름 1 ~ 40 · 고유 · 블록 10) · 판 source · 권한 주소 7 · 지우는 문장 없음',
   'gwan_page_fragments' in M6 and 'BETWEEN 1 AND 40' in M6 and 'gwan_page_fragments_name_uniq' in M6 and 'jsonb_array_length(blocks) <= 10' in M6
   and 'ADD COLUMN IF NOT EXISTS source jsonb' in M6 and M6.count("'/admin/gwan") == 7 and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', M6), str(len(M6)))
SS, SC = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts')
GS, GC = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts')
ok('① 서버 — 현황(7 · 30 · 90 · 날마다 · 지금) · 조각 펼침(게시 · 예약 · 미리보기 · 번역) · source · 조각 안 조각 막음 · 쓰는 페이지 있으면 지우기 422',
   'async gwanStats(' in SS and "@Get('gwans/:code/stats')" in SC and '[7, 30, 90].includes(days0)' in SS
   and 'async expand(' in GS and GS.count('await this.expand(') >= 4 and 'source)' in GS and 'coalesce(v.source, v.blocks)' in GS
   and "noFragment: true, max: 10" in GS and 'GWAN_FRAGMENT_IN_USE' in GS and "@Delete('admin/gwan-fragments/:id')" in GC, '')
GSet, GP, PH = rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/gwans/pageHtml.ts')
ok('① 운영 화면 — 현황판 · 끌어 놓기(⠿ · onDrop · Alt + 화살표) · 조각 넣기 · 조각으로 · 공통 조각 상자 · HTML 왕복에 조각 자리',
   'function StatsBoard(' in GSet and 'data-gwan-stats' in GSet and "{tab === 'stats' && <StatsBoard" in GSet
   and 'data-gwan-page-drag' in GP and 'onDrop=' in GP and 'e.altKey' in GP and 'const moveTo = ' in GP
   and 'data-gwan-page-fragment-add' in GP and 'data-gwan-page-to-fragment' in GP and 'function Fragments(' in GP and 'data-gwan-fragments' in GP
   and 'data-block="FRAGMENT"' in PH and "kind === 'FRAGMENT'" in PH, '')
ok('① 영어 3 · screens.json(현황 · 조각 5)',
   all(k in rd('src/common/i18n/server-text.en.ts') for k in ('없는 조각입니다.', '같은 이름의 조각이 있습니다.', '조각 이름을 넣으십시오.'))
   and all(a in rd('spec/screens.json') for a in ('GET /admin/gwans/{code}/stats', 'POST /admin/gwan-fragments', 'DELETE /admin/gwan-fragments/{id}')), '')

# ── ② DB ───────────────────────────────────────────────────────────────
if DB and DB_UP:
    d1 = psql("BEGIN; INSERT INTO gwan_page_fragments (name) VALUES (repeat('가', 41)); ROLLBACK;")
    d2 = psql("BEGIN; INSERT INTO gwan_page_fragments (name, blocks) SELECT 'zz11', jsonb_agg(jsonb_build_object('type', 'CATEGORIES')) FROM generate_series(1, 11); ROLLBACK;")
    ok('② DB — 이름 41자 · 블록 11개 막힘', 'check' in d1.lower() and 'check' in d2.lower(), f'{d1[-50:]} | {d2[-50:]}')

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    slug, fname = f'zf{stamp}', f'시험 조각 {stamp}'
    fid = None
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = login('admin@x.com')
        s7 = call('GET', '/admin/gwans/MNY/stats?days=7', None, TS_)
        sx = call('GET', '/admin/gwans/MNY/stats?days=5', None, TS_)
        ok('③ 현황 — 7일 7줄 · 합 · 지금 숫자 · 틀린 기간은 30',
           s7.get('days') == 7 and len(s7.get('rows') or []) == 7 and 'views' in (s7.get('total') or {}) and 'reviewPending' in (s7.get('now') or {}) and sx.get('days') == 30,
           f"{s7.get('days')} · {len(s7.get('rows') or [])} · {sx.get('days')}")
        f0 = call('POST', '/admin/gwan-fragments', {'name': fname, 'blocks': [{'type': 'BUTTONS', 'items': [{'label': '문의하기', 'href': '/support'}]}]}, TS_)
        fid = f0.get('id')
        dup = call('POST', '/admin/gwan-fragments', {'name': fname.upper()}, TS_)
        nest = call('PATCH', f'/admin/gwan-fragments/{fid}', {'blocks': [{'type': 'FRAGMENT', 'fragmentId': fid}]}, TS_)
        ok('③ 조각 — 만들기 · 같은 이름 409 · 조각 안 조각 422', bool(fid) and dup.get('_err') == 409 and nest.get('_err') == 422, f"{fid} · {dup.get('_err')} · {nest.get('_err')}")
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 조각 페이지'}, TS_)
        pid = pg.get('id')
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '본문'}, {'type': 'FRAGMENT', 'fragmentId': fid, 'name': fname}]}, TS_)
        pub = call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        live = call('GET', f'/gwans/MNY/pages/{slug}')
        ok('③ 게시 — 판은 펼친 블록(TEXT · BUTTONS) · 초안은 조각 자리 · 「초안 다름」 아님',
           [b.get('type') for b in (live.get('blocks') or [])] == ['TEXT', 'BUTTONS'] and [b.get('type') for b in (pub.get('blocks') or [])] == ['TEXT', 'FRAGMENT'] and pub.get('draftChanged') is False,
           f"{[b.get('type') for b in (live.get('blocks') or [])]} · {[b.get('type') for b in (pub.get('blocks') or [])]} · {pub.get('draftChanged')}")
        call('PATCH', f'/admin/gwan-fragments/{fid}', {'blocks': [{'type': 'BUTTONS', 'items': [{'label': '새 문의', 'href': '/support'}]}]}, TS_)
        live2 = call('GET', f'/gwans/MNY/pages/{slug}')
        det = call('GET', f'/admin/gwan-fragments/{fid}', None, TS_)
        de = call('DELETE', f'/admin/gwan-fragments/{fid}', None, TS_)
        pv = call('POST', f'/admin/gwan-pages/{pid}/previews', {'hours': 1}, TS_)
        prv = call('GET', f"/gwan-pages/preview/{pv.get('token')}")
        ok('③ 조각 고침 — 게시 판 그대로(문의하기) · 미리보기는 새 내용(새 문의) · 쓰는 페이지 1(게시 판에도) · 지우기 422',
           ((live2.get('blocks') or [{}, {}])[1].get('items') or [{}])[0].get('label') == '문의하기'
           and any(((b.get('items') or [{}])[0].get('label') == '새 문의') for b in (prv.get('blocks') or []) if b.get('type') == 'BUTTONS')
           and len(det.get('usedBy') or []) == 1 and (det.get('usedBy') or [{}])[0].get('published') is True and de.get('code') == 'GWAN_FRAGMENT_IN_USE',
           f"{len(det.get('usedBy') or [])} · {de.get('code')}")
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '본문'}]}, TS_)
        de2 = call('DELETE', f'/admin/gwan-fragments/{fid}', None, TS_)
        ok('③ 조각 블록을 빼면 지움', de2.get('deleted') == fid, str(de2))
        if de2.get('deleted') == fid:
            fid = None
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        psql(f"DELETE FROM gwan_page_fragments WHERE name = '{fname}'")
        psql(f"DELETE FROM ops_alerts WHERE alert_code LIKE 'GWAN_PAGE_%' AND detail->>'slug' = '{slug}'")
        ok('③ 끝 — 시험 페이지 · 조각 · 알림 지움', psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM gwan_page_fragments WHERE name = '{fname}')") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d797 = doc('797_')
ok('④ 문서 797 — 현황 · 끌어 놓기 · 공통 조각 · D316', all(w in d797 for w in ('관 현황판', '블록 끌어 놓기', '공통 조각', 'D316', 'source')), str(len(d797)))
ok('④ VERSION v10.672 이상', VT >= (10, 672), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
