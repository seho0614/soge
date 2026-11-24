"""v10.675 ~ 679 (D317 · docs/798) 조각 쓰는 페이지 한꺼번에 다시 게시 · 메인 새 관 카드 · 관 목록 7일 숫자 · 예약 게시 판 바로잡기 · 판 바로 되돌리기
  ① (코드) D317 · 서버(rollback · republishFragment · scheduled_source · gwanAdmin 숫자) · 운영 화면(되돌리기 · 다시 게시 · 7일 열 · 메인 카드) · 사용자 웹 newCards · 영어 · screens.json
  ② (DB) site.new_gwan_cards 무늬 — 4개 막힘(되돌림)
  ③ (API) 관리 목록 7일 숫자 · 설정 저장 → 공개 설정 · 되돌리기(사유 1자 400 · 지금 판 422 · 새 판 · 블록 같음 · 알림)
       · 조각 다시 게시(다른 고침 있는 페이지 건너뜀 · 깨끗한 페이지 새 판) · 예약 판 source(조각 페이지 예약 → 시각 지남 → 「초안 다름」 아님) — 끝나면 지움 · 설정 되돌림
  ④ 문서 798 · 판
  (두 번 돌아도 통과 — 이름 · 주소에 시각 · 시작 시각 뒤 알림만)
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
M7 = rd('prisma/migrations/D317_gwan_page_rollback_main_cards/migration.sql')
ok('① D317 — scheduled_source · 설정 site.new_gwan_cards(GLOBAL · 무늬) · 권한 주소 2 · 지우는 문장 없음',
   'scheduled_source jsonb' in M7 and "'site.new_gwan_cards', '', 'GLOBAL'" in M7 and "'^$|^[A-Z]{3,4}(,[A-Z]{3,4}){0,2}$'" in M7
   and M7.count("'/admin/gwan") == 2 and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', M7), str(len(M7)))
GS, GC, SS = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('src/modules/site/site.service.ts')
ok('① 서버 — 되돌리기(사유 · 지금 판 막음 · 새 판 · 알림) · 조각 다시 게시(다른 고침 건너뜀) · 예약 source · 관리 목록 7일 숫자',
   'async rollback(' in GS and 'GWAN_PAGE_ROLLBACK_SAME' in GS and 'rollback: true' in GS and 'async republishFragment(' in GS and "'DRAFT_CHANGED'" in GS
   and 'scheduled_source = $6::jsonb' in GS and 'p.scheduled_source' in GS and "@Post('admin/gwan-pages/:id/rollback')" in GC and "@Post('admin/gwan-fragments/:id/republish')" in GC
   and '"views7"' in SS and '"newListings7"' in SS and '"isNew"' in SS, '')
GL, GP, HV = rd('web/src/app/admin/gwans/GwanList.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('site/src/components/home/HomeView.tsx')
ok('① 화면 — 관 목록 7일 열 · 메인 새 관 카드(3칸 · 저장) · 바로 되돌리기 · 한꺼번에 다시 게시 · 메인 newCards',
   'data-gwan-week' in GL and 'function MainCards(' in GL and "key: 'site.new_gwan_cards'" in GL and 'data-gwan-page-rollback' in GP and 'data-gwan-fragment-republish' in GP
   and "newCards(_gwans, settings['site.new_gwan_cards'])" in HV, '')
ok('① 영어 2 · screens.json(되돌리기 · 다시 게시 · 설정)',
   all(k in rd('src/common/i18n/server-text.en.ts') for k in ('되돌리는 사유를 2자 이상 적으십시오.', '지금 게시된 판입니다.'))
   and all(a in rd('spec/screens.json') for a in ('POST /admin/gwan-fragments/{id}/republish', 'POST /admin/gwan-pages/{id}/rollback', 'PATCH /admin/site-settings')), '')

# ── ② DB ───────────────────────────────────────────────────────────────
if DB and DB_UP:
    d1 = psql("BEGIN; UPDATE site_settings SET value = 'AAA,BBB,CCC,DDD' WHERE key = 'site.new_gwan_cards'; ROLLBACK;")
    ok('② DB — 새 관 카드 4개는 무늬에 막힘', '!' in d1, d1[-80:])

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    T0 = psql("SELECT to_char(clock_timestamp() - interval '2 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")
    s1, s2, fname = f'zr{stamp}', f'zq{stamp}', f'시험 조각 75 {stamp}'
    was = psql("SELECT value FROM site_settings WHERE key = 'site.new_gwan_cards'")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = login('admin@x.com')
        mg = call('GET', '/admin/gwans/manage', None, TS_)
        mny = next((g for g in mg if isinstance(mg, list) and g.get('code') == 'MNY'), {}) if isinstance(mg, list) else {}
        ok('③ 관리 목록 — 7일 방문 · 새 매물 · 새 요청 · 검수 대기 · 새 관 표시', all(k in mny for k in ('views7', 'newListings7', 'newRequests7', 'reviewPending', 'isNew')) and mny.get('isNew') is False, str({k: mny.get(k) for k in ('views7', 'newListings7', 'isNew')}))
        up = call('PATCH', '/admin/site-settings', {'key': 'site.new_gwan_cards', 'value': 'ZZQA,ZZQB', 'reason': '시험'}, TS_)
        pub = call('GET', '/site-settings/public')
        ok('③ 메인 새 관 카드 설정 — 저장 · 공개 설정에 보임', up.get('_err') is None and pub.get('site.new_gwan_cards') == 'ZZQA,ZZQB', f"{up.get('_err')} · {pub.get('site.new_gwan_cards')}")
        # 되돌리기
        p1 = call('POST', '/admin/gwans/MNY/pages', {'slug': s1, 'title': '시험 되돌리기'}, TS_); id1 = p1.get('id')
        call('PATCH', f'/admin/gwan-pages/{id1}', {'blocks': [{'type': 'TEXT', 'body': '첫 판'}]}, TS_); call('POST', f'/admin/gwan-pages/{id1}/publish', None, TS_)
        call('PATCH', f'/admin/gwan-pages/{id1}', {'blocks': [{'type': 'TEXT', 'body': '둘째 판'}]}, TS_); call('POST', f'/admin/gwan-pages/{id1}/publish', None, TS_)
        r_short = call('POST', f'/admin/gwan-pages/{id1}/rollback', {'version': 1, 'reason': 'x'}, TS_)
        r_same = call('POST', f'/admin/gwan-pages/{id1}/rollback', {'version': 2, 'reason': '같은 판'}, TS_)
        r_ok = call('POST', f'/admin/gwan-pages/{id1}/rollback', {'version': 1, 'reason': '시험 되돌림'}, TS_)
        live = call('GET', f'/gwans/MNY/pages/{s1}')
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'GWAN_PAGE_PUBLISHED' AND raised_at >= '{T0}' AND (detail->>'pageId')::int = {int(id1 or 0)} AND detail->>'rollback' = 'true'")
        ok('③ 되돌리기 — 사유 1자 400 · 지금 판 422 · 3판 게시(첫 판 글) · 초안은 그대로(둘째 판) · 알림',
           r_short.get('_err') == 400 and r_same.get('code') == 'GWAN_PAGE_ROLLBACK_SAME' and r_ok.get('publishedVersion') == 3
           and (live.get('blocks') or [{}])[0].get('body') == '첫 판' and (r_ok.get('blocks') or [{}])[0].get('body') == '둘째 판' and al == '1',
           f"{r_short.get('_err')} · {r_same.get('code')} · {r_ok.get('publishedVersion')} · {(live.get('blocks') or [{}])[0].get('body')} · {al}")
        # 조각 다시 게시
        f0 = call('POST', '/admin/gwan-fragments', {'name': fname, 'blocks': [{'type': 'TEXT', 'body': '조각 1'}]}, TS_); fid = f0.get('id')
        p2 = call('POST', '/admin/gwans/MNY/pages', {'slug': s2, 'title': '시험 조각 다시'}, TS_); id2 = p2.get('id')
        for pid in (id1, id2):
            call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'FRAGMENT', 'fragmentId': fid, 'name': fname}]}, TS_); call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        call('PATCH', f'/admin/gwan-pages/{id1}', {'blocks': [{'type': 'FRAGMENT', 'fragmentId': fid, 'name': fname}, {'type': 'TEXT', 'body': '다른 고침'}]}, TS_)
        call('PATCH', f'/admin/gwan-fragments/{fid}', {'blocks': [{'type': 'TEXT', 'body': '조각 2'}]}, TS_)
        rp = call('POST', f'/admin/gwan-fragments/{fid}/republish', {}, TS_)
        res = {x.get('id'): x.get('result') for x in (rp.get('items') or [])}
        l1, l2 = call('GET', f'/gwans/MNY/pages/{s1}'), call('GET', f'/gwans/MNY/pages/{s2}')
        ok('③ 조각 다시 게시 — 깨끗한 페이지 새 판(조각 2) · 다른 고침 있는 페이지 건너뜀(조각 1 그대로)',
           res.get(id2) == 'PUBLISHED' and res.get(id1) == 'DRAFT_CHANGED' and (l2.get('blocks') or [{}])[0].get('body') == '조각 2' and (l1.get('blocks') or [{}])[0].get('body') == '조각 1',
           f"{res} · {(l2.get('blocks') or [{}])[0].get('body')} · {(l1.get('blocks') or [{}])[0].get('body')}")
        # 예약 판 source
        sch = call('POST', f'/admin/gwan-pages/{id2}/schedule', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))}, TS_)
        psql(f"UPDATE gwan_pages SET scheduled_at = now() - interval '1 minute' WHERE id = {int(id2 or 0)}")
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")   # v10.705 예약 게시는 관이 닫혀 있을 때만(열려 있으면 기다림)
        rows = call('GET', '/admin/gwans/MNY/pages', None, TS_)
        psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
        me = next((r for r in rows if r.get('id') == id2), {}) if isinstance(rows, list) else {}
        src = psql(f"SELECT (v.source IS NOT NULL)::text FROM gwan_page_versions v JOIN gwan_pages p ON p.id = v.page_id AND v.version = p.published_version WHERE p.id = {int(id2 or 0)}")
        ok('③ 예약 판 — 조각 페이지 예약 게시 뒤 source 있음 · 「초안 다름」 아님', bool(sch.get('scheduledAt')) and me.get('scheduledAt') is None and src == 'true' and me.get('draftChanged') is False,
           f"{bool(sch.get('scheduledAt'))} · {src} · {me.get('draftChanged')}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug IN ('{s1}', '{s2}')); DELETE FROM gwan_pages WHERE slug IN ('{s1}', '{s2}');")
        psql(f"DELETE FROM gwan_page_fragments WHERE name = '{fname}'")
        psql(f"DELETE FROM ops_alerts WHERE alert_code LIKE 'GWAN_PAGE_%' AND detail->>'slug' IN ('{s1}', '{s2}')")
        psql(f"UPDATE site_settings SET value = '{was}' WHERE key = 'site.new_gwan_cards'")
        ok('③ 끝 — 시험 페이지 · 조각 · 알림 지움 · 설정 되돌림',
           psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug IN ('{s1}', '{s2}')) + (SELECT count(*) FROM gwan_page_fragments WHERE name = '{fname}')") == '0'
           and psql("SELECT value FROM site_settings WHERE key = 'site.new_gwan_cards'") == was, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d798 = doc('798_')
ok('④ 문서 798 — 다시 게시 · 메인 새 관 카드 · 7일 · 예약 판 · 되돌리기 · D317',
   all(w in d798 for w in ('한꺼번에 다시 게시', '메인 새 관 카드', '7일 방문', 'scheduled_source', '바로 되돌리기', 'D317')), str(len(d798)))
ok('④ VERSION v10.675 이상', VT >= (10, 675), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
