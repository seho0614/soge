"""v10.211 (D188 · docs/336) — 동네픽 AI 큐레이션(꺼진 채 · 운영자 승인만 공개)

  ① (코드) D188 후보 표 · 트리거(대기로 시작 · 한 번 처리 · 지우지 못함) · 공개 보기(30일 · 원글 공개) · 통로 TOWN_PICK · 스위치 off · 작업 06:00
     · 고르기(신고 · 운영자 · 광고 글 빼고 · 연락처 표시 · 쓴 사람 안 보냄) · API 5 · 운영 칸 · 사용자 줄(ko · en) · 통합 검정 시험 · 영어 · 명세 · 문서 336
  ② (DB) 마이그레이션 · 통로 꺼짐 · 지우기 막힘 · 승인으로 시작 막힘
  ③ (API) 지금 고르기 → 건너뜀 · 운영 목록 · 승인(고친 제목) · 거절(사유) · 다시 처리 422 · 공개(내 지역 · 전국) · 회원 403
  ④ (화면) 운영 소개광장 「동네픽 후보」 · 사용자 /community 맨 위 「동네픽」
"""
import json, os, re, subprocess, urllib.error, urllib.parse, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D188_town_pick_ai/migration.sql')
ok('① D188 — 후보 표(같은 글 한 번) · 대기로 시작 · 한 번 처리 · 지우지 못함 · 공개 보기 30일 · 통로 TOWN_PICK · 스위치 off · 06:00 작업 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.town_pick_candidates' in M and 'CONSTRAINT ux_town_pick_post UNIQUE (post_id)' in M
   and "'TOWNPICK: 동네픽 후보는 대기로 시작합니다.'" in M and "'TOWNPICK: 이미 처리한 동네픽 후보입니다.'" in M and "'TOWNPICK: 동네픽 후보 기록은 지울 수 없습니다.'" in M
   and "c.state = 'APPROVED' AND p.state = 'PUBLISHED' AND c.decided_at > now() - interval '30 days'" in M
   and "'BOARD','TOWN_PICK'" in M and "WHEN 'TOWN_PICK' THEN 'agent.town_pick.enabled'" in M and "('agent.town_pick.enabled', 'off'," in M
   and "('town_pick_daily', 1440, 6, 0, NULL, true," in M and not re.search(r'\b(DROP TABLE|TRUNCATE|DELETE FROM)\b', M), '')
SV, C = rd('src/modules/community/town-pick.service.ts'), rd('src/modules/community/town-pick.controller.ts')
SCH, WK, AG, AM = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/modules/agent/agent.service.ts'), rd('src/app.module.ts')
ok('① 고르기 — 통로 먼저 · 신고 · 광고 · 운영자 글 빼고 · 연락처 표시 · 쓴 사람 안 보냄 · 3개까지 · 작업 연결 · 통로 이름 · 등록',
   "this.agent.allowed('TOWN_PICK')" in SV and 'p.report_count = 0 AND coalesce(f.sponsored, false) = false' in SV and "r.role IN ('ADMIN', 'SUPER')" in SV
   and 'redactContacts(p.body)' in SV and 'author' not in SV.split('const data = {')[1].split('};')[0] and 'const MAX_PICKS = 3;' in SV
   and "case 'town_pick_daily':" in SCH and "'town_pick_daily'," in WK and "| 'TOWN_PICK'" in AG and 'TownPickController,' in AM and 'TownPickService,' in AM, '')
EN, SC, FIL = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json'), rd('src/common/db-error.filter.ts')
KO, ENP = json.loads(rd('site/src/i18n/messages/ko/plaza.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/plaza.json') or '{}')
ok('① API 5(공개 · ADMIN · SUPER · 감사) · TOWNPICK → 422 · 운영 칸 · 사용자 줄 · 사전 ko · en 같은 키 · 영어 · 명세 · 통합 검정',
   "@Get('community/town-picks')" in C and "@Roles('SUPER')" in C and "@Audit('TOWN_PICK_APPROVE', 'POST')" in C and "code: 'TOWN_PICK_RULE'" in FIL
   and '<TownPicks />' in rd('web/src/app/admin/Community.tsx') and '<TownPicks loggedIn=' in rd('site/src/app/community/page.tsx')
   and set((KO.get('picks') or {}).keys()) == set((ENP.get('picks') or {}).keys()) and len(KO.get('picks') or {}) >= 5
   and '"이미 처리한 동네픽 후보입니다.":' in EN and '"GET /community/town-picks"' in SC and '"POST /admin/community/town-picks/{id}/approve"' in SC
   and 'scripts/test-town-pick.ts' in rd('scripts/verify-all.sh'), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('336_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 336 · 판 v10.211 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 211), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


SUPU = 'admin@x.com'; BUY = 'buyer@x.com'
REG = '시험특별시 픽구1211'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    try:
        mig = psql("SELECT count(*) FROM schema_migrations WHERE name = 'D188_town_pick_ai'")
        ch = psql("SELECT coalesce(reason, 'OK') FROM fn_agent_allowed('TOWN_PICK')")
        sw = psql("SELECT value FROM site_settings WHERE key = 'agent.town_pick.enabled'")
        posts = psql("SELECT string_agg(id::text, ',') FROM (SELECT id FROM posts WHERE state = 'PUBLISHED' AND board <> 'NOTICE' "
                     "AND NOT EXISTS (SELECT 1 FROM town_pick_candidates c WHERE c.post_id = posts.id) ORDER BY created_at DESC LIMIT 2) x").split(',')
        cands = []
        for i, pid in enumerate(p for p in posts if p):
            cands.append(psql(f"INSERT INTO town_pick_candidates (post_id, source, region, headline, summary, engine, model) "
                              f"VALUES ('{pid}', 'PLAZA', '{REG}', '시험 동네픽 {i + 1}', '시험 1211 — 이웃에게 도움이 되는 글', 'MOCK', 'mock') RETURNING id"))
        bad = psql(f"INSERT INTO town_pick_candidates (post_id, source, region, headline, summary, engine, state) "
                   f"VALUES ('{posts[0]}', 'PLAZA', '{REG}', '승인으로', '시작 막힘 시험', 'MOCK', 'APPROVED')") if posts and posts[0] else '!'
        ok('② D188 적용 · 통로 꺼짐(AI 전체 · 동네픽 스위치) · 스위치 off · 후보 2개 넣음 · 승인으로 시작 · 같은 글 다시 막힘',
           mig == '1' and ch in ('AGENT_OFF', 'CHANNEL_OFF', 'CAP_ZERO') and sw == 'off' and len(cands) == 2 and all(re.match(r'^[0-9a-f-]{36}$', x) for x in cands)
           and bad.startswith('!'), f'{mig} · {ch} · {sw} · {cands} · {bad[:60]}')

        consent_ok.agree(SUPU, PW); consent_ok.agree(BUY, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        run = call('POST', '/admin/community/town-picks/run', None, TS)
        ls = call('GET', '/admin/community/town-picks', None, TS)
        mine = [x for x in ls.get('items') or [] if x.get('id') in cands]
        mb = call('GET', '/admin/community/town-picks', None, TB)
        mr = call('POST', '/admin/community/town-picks/run', None, TB)
        ok('③ 지금 고르기 → 건너뜀(통로 꺼짐) · 운영 목록(대기 2 · 통로 꺼짐 표시) · 회원 목록 · 고르기 403',
           run.get('affected') == 0 and (run.get('detail') or {}).get('skipped') in ('AGENT_OFF', 'CHANNEL_OFF', 'CAP_ZERO') and len(mine) == 2
           and (ls.get('channel') or {}).get('ok') is False and mb.get('_err') == 403 and mr.get('_err') == 403,
           f'{run} · {len(mine)} · {ls.get("channel")} · {mb.get("_err")} {mr.get("_err")}')

        a1 = call('POST', f'/admin/community/town-picks/{cands[0]}/approve', {'headline': '고친 시험 동네픽'}, TS) if cands else {}
        e1 = call('POST', f'/admin/community/town-picks/{cands[1]}/reject', {'note': 'x'}, TS) if len(cands) > 1 else {}
        r1 = call('POST', f'/admin/community/town-picks/{cands[1]}/reject', {'note': '시험 1211 거절'}, TS) if len(cands) > 1 else {}
        a2 = call('POST', f'/admin/community/town-picks/{cands[0]}/approve', {}, TS) if cands else {}
        pub = call('GET', '/community/town-picks?region=' + urllib.parse.quote(REG))
        pall = call('GET', '/community/town-picks')
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action IN ('TOWN_PICK_APPROVE', 'TOWN_PICK_REJECT') AND occurred_at > now() - interval '10 minutes'")
        ok('③ 승인(고친 제목) · 짧은 사유 400/422 · 거절 · 다시 처리 422 · 공개 — 내 지역 1개(고친 제목) · 거절 안 보임 · 지역 없으면 전국 · 감사',
           a1.get('state') == 'APPROVED' and e1.get('_err') in (400, 422) and r1.get('state') == 'REJECTED' and a2.get('code') == 'TOWN_PICK_DECIDED'
           and pub.get('region') == REG and [x.get('headline') for x in pub.get('items') or []] == ['고친 시험 동네픽']
           and pall.get('region') is None and any(x.get('id') == cands[0] for x in pall.get('items') or []) and not any(x.get('id') == cands[1] for x in pall.get('items') or [])
           and au.isdigit() and int(au) >= 2,
           f'{a1} · {e1.get("_err")} · {r1} · {a2.get("code")} · {pub} · 감사 {au}')

        dl = psql(f"BEGIN; DELETE FROM town_pick_candidates WHERE id = '{cands[0]}'; ROLLBACK;") if cands else '!'
        up = psql(f"BEGIN; UPDATE town_pick_candidates SET headline = '바꿈 시험' WHERE id = '{cands[0]}'; ROLLBACK;") if cands else '!'
        ok('② 지우기 막힘 · 처리한 뒤 제목 못 바꿈', dl.startswith('!') and '지울 수 없습니다' in dl and up.startswith('!') and '이미 처리한' in up, f'{dl[:60]} · {up[:60]}')

        errs, seen = [], {}
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/community', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['adm'] = pg.evaluate("() => document.querySelector('[data-town-picks] h3')?.textContent ?? ''")
                seen['ch'] = pg.evaluate("() => document.querySelector('[data-town-pick-channel]')?.getAttribute('data-town-pick-channel') ?? ''")
                if SITE:
                    sp = b.new_page(viewport={'width': 1280, 'height': 900}); sp.on('pageerror', lambda e: errs.append(str(e)[:100]))
                    sp.goto(SITE + '/community', wait_until='networkidle', timeout=120000); sp.wait_for_timeout(3000)
                    seen['site'] = sp.evaluate("() => [...document.querySelectorAll('[data-town-picks] [data-town-pick]')].map(e => e.textContent).join(' | ')")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 운영 「동네픽 후보」(꺼짐 표시) · 사용자 /community 맨 위 「동네픽」에 승인한 글 · 오류 없음',
           '동네픽 후보' in seen.get('adm', '') and seen.get('ch') == 'off' and (not SITE or '고친 시험 동네픽' in seen.get('site', '')) and not errs, f'{seen} · {errs[:2]}')
    finally:
        pass

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
