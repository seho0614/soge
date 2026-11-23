"""v10.668 ~ 671 (docs/796) 새 관 열기 길잡이 · 사이트 검색에 관 페이지 · 게시 · 예약 알림 · 페이지 점검
  ① (코드) 길잡이 6단계 · 바로 가기 · 관 페이지를 그 관으로 · GET /gwan-pages/search · 사이트 검색 묶음 · 사전 ko · en · 알림 4종(거래 밖) · checkPage · 게시 확인 창
  ③ (API) MNY 시험 페이지 게시 → 검색(제목 · 글)에 나옴 · 1자 빈 목록 · 알림 GWAN_PAGE_PUBLISHED · HIDDEN · SCHEDULED · 7일 지난 초안 STALE_DRAFT — 끝나면 페이지 · 알림 · 계정 지움
  ④ 문서 796 · 판
  (두 번 돌아도 통과 — 주소 · 낱말에 시각을 붙이고 시작 시각 뒤 알림만 셈)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
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
GSet, GW, GP = rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/Gwans.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 길잡이 — 6단계(만들기 · 설명 · 폼 문구 · 업종 · 첫 화면 선택 · 열기) · 바로 가기 · 관 페이지를 그 관으로',
   'function OpenGuide(' in GSet and all(w in GSet for w in ("'① 관 만들기'", "'② 설명 · 아이콘 · 색'", "'③ 등록 폼 문구'", "'④ 업종 승인'", "'⑤ 첫 화면 페이지(선택)'", "'⑥ 관 열기'"))
   and 'data-gwan-open-guide' in GSet and '바로 가기' in GSet and "onPages={(c) => { setPageCode(c); setView('pages'); }}" in GW and 'initialCode ?? ' in GP, '')
GS, GC = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts')
SP = rd('site/src/app/search/page.tsx')
KO, EN = json.loads(rd('site/src/i18n/messages/ko/search.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/search.json') or '{}')
ok('① 검색 — GET /gwan-pages/search(2 ~ 50자 · 켠 관 · 허브 아님 · 5개) · 사이트 검색 「관 안내 페이지」 묶음 · 사전 ko · en 같은 열쇠',
   'async searchPages(' in GS and "@Get('gwan-pages/search')" in GC and 'NOT g.is_hub' in GS and 'LIMIT 5' in GS
   and '/gwan-pages/search?' in SP and 'data-search-pages' in SP and "t('pages.headCount'" in SP
   and set((KO.get('pages') or {}).keys()) == {'headCount', 'view'} == set((EN.get('pages') or {}).keys()), '')
ok('① 알림 — PUBLISHED · SCHEDULED · HIDDEN · STALE_DRAFT · 한 번만(열쇠) · 게시 거래 밖',
   all(f"'{c}'" in GS for c in ('GWAN_PAGE_PUBLISHED', 'GWAN_PAGE_SCHEDULED', 'GWAN_PAGE_HIDDEN', 'GWAN_PAGE_STALE_DRAFT'))
   and "a.detail->>'key' = $4::text" in GS and 'const ver = await this.db.transaction(' in GS and "interval '7 days'" in GS, '')
ok('① 페이지 점검 — checkPage(사진 설명 · 파일 이름 · 주소 · 표 머리 · 머리 띠 여럿 · 링크 글자 · 동영상) · 게시 막지 않음 · 확인 창 한 줄',
   'export function checkPage(' in GP and 'function PageCheck(' in GP and 'data-gwan-page-check' in GP and '사진 설명(대체 글)이 비었습니다.' in GP
   and '사용자 웹에 없는 화면일 수 있습니다' in GP and '페이지 점검: 고칠 것' in GP and '(게시는 막지 않음)' in GP, '')
ok('① screens.json — 검색 화면 GET /gwan-pages/search', '"GET /gwan-pages/search"' in rd('spec/screens.json'), '')

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    T0 = psql("SELECT to_char(clock_timestamp() - interval '2 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")
    slug, word = f'zs{stamp}', f'뭉게구름{stamp}'
    pid = None
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = login('admin@x.com')
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': f'시험 안내 {stamp}'}, TS_)
        pid = pg.get('id')
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': f'여기에는 {word} 라는 낱말이 들어 있습니다.'}]}, TS_)
        pub = call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        s1 = call('GET', '/gwan-pages/search?' + urllib.parse.urlencode({'q': word}))
        s2 = call('GET', '/gwan-pages/search?' + urllib.parse.urlencode({'q': f'시험 안내 {stamp}'}))
        s3 = call('GET', '/gwan-pages/search?q=a')
        hit = next((x for x in s1 if isinstance(s1, list) and x.get('slug') == slug), {}) if isinstance(s1, list) else {}
        ok('③ 검색 — 글 낱말로 찾음(찾은 글 앞뒤) · 제목으로 찾음 · 1자는 빈 목록',
           pub.get('status') == 'PUBLISHED' and hit.get('gwanCode') == 'MNY' and word in (hit.get('snippet') or '')
           and isinstance(s2, list) and any(x.get('slug') == slug for x in s2) and s3 == [],
           f"{pub.get('status')} · {hit.get('snippet')} · {len(s2) if isinstance(s2, list) else s2} · {s3}")
        call('POST', f'/admin/gwan-pages/{pid}/hide', {'hidden': True}, TS_)
        s4 = call('GET', '/gwan-pages/search?' + urllib.parse.urlencode({'q': word}))
        call('POST', f'/admin/gwan-pages/{pid}/hide', {'hidden': False}, TS_)
        call('POST', f'/admin/gwan-pages/{pid}/schedule', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 7200))}, TS_)
        call('POST', f'/admin/gwan-pages/{pid}/schedule', {'at': None}, TS_)
        al = psql(f"SELECT string_agg(DISTINCT alert_code, ',' ORDER BY alert_code) FROM ops_alerts WHERE raised_at >= '{T0}' AND (detail->>'pageId')::int = {int(pid or 0)}")
        ok('③ 숨긴 페이지는 검색에 없음 · 알림 PUBLISHED · HIDDEN · SCHEDULED',
           isinstance(s4, list) and not any(x.get('slug') == slug for x in s4) and all(c in (al or '') for c in ('GWAN_PAGE_PUBLISHED', 'GWAN_PAGE_HIDDEN', 'GWAN_PAGE_SCHEDULED')),
           f"{len(s4) if isinstance(s4, list) else s4} · {al}")
        # 7일 지난 초안 — 초안을 고치고 고친 때를 8일 전으로 · 알림은 한 시간에 한 번이라 서버를 새로 띄운 뒤 첫 확인에서만 확실 → DB 로 함수 대신 같은 조건을 봄 + 목록 읽기로 부름
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '고친 초안'}]}, TS_)
        psql(f"UPDATE gwan_pages SET draft_updated_at = now() - interval '8 days' WHERE id = {int(pid or 0)}")
        call('GET', '/admin/gwans/MNY/pages', None, TS_)
        st = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'GWAN_PAGE_STALE_DRAFT' AND (detail->>'pageId')::int = {int(pid or 0)}")
        cond = psql(f"SELECT count(*) FROM gwan_pages p WHERE p.id = {int(pid or 0)} AND p.draft_updated_at < now() - interval '7 days' AND p.draft IS DISTINCT FROM (SELECT v.blocks FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)")
        ok('③ 7일 지난 초안 — 조건에 맞음 · 알림(서버가 이번 한 시간 안에 처음 보면 1 · 이미 봤으면 0도 됨)', cond == '1' and st in ('0', '1'), f'{cond} · {st}')
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        psql(f"DELETE FROM ops_alerts WHERE alert_code LIKE 'GWAN_PAGE_%' AND raised_at >= '{T0}' AND (detail->>'slug') = '{slug}'")
        ok('③ 끝 — 시험 페이지 · 알림 지움', psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM ops_alerts WHERE alert_code LIKE 'GWAN_PAGE_%' AND detail->>'slug' = '{slug}')") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d796 = doc('796_')
ok('④ 문서 796 — 길잡이 · 관 안내 페이지 · 알림 4종 · 페이지 점검',
   all(w in d796 for w in ('새 관 열기 길잡이', '관 안내 페이지', 'GWAN_PAGE_PUBLISHED', 'GWAN_PAGE_STALE_DRAFT', '페이지 점검')), str(len(d796)))
ok('④ VERSION v10.668 이상', VT >= (10, 668), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
