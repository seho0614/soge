"""v10.244 ~ v10.246 (D202 · docs/383) — 운영 적용 기록 · 하루 요약 「대표 할 일」 줄 · 「적기」 지난 기록

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1244.py

  ① (코드) D202 ops_release_log(쌓기만 · fn_block_write) · ReleaseLogService(뜰 때 record · 같은 판이면 안 적음 · postcheck 파일 읽기만) ·
     releases API · owner-todo/marks API · 하루 요약 두 줄 · 화면(지금 판 카드 · 「기록」) · 명세 · 영어 · 문서 383 · 판 v10.246 이상
  ② (API) 지금 판 = VERSION · 가장 최근 기록 줄 = 지금 판 · 점검판에는 postcheck 결과 파일 없음(null) · ADMIN 도 봄 · 일반 회원 403 · 고치기 · 지우기 · 이상한 kind 막힘
  ③ (API) 하루 요약 — 「대표 할 일 끝남 n / 15 · 아직: …」가 owner-todo 와 맞음 · 「운영 판 … · 마지막 바뀜 …」
  ④ (API) 「적기」 지난 기록 — 두 번 적으면 전체 +2 · 가장 최근 줄이 맨 위 · 누가 · 20줄 넘지 않음 · 자동 줄 · 빈 key 422 · ADMIN 도 봄
  ⑤ (화면) 지금 판 카드(판 · 기록 줄 · 결과 파일 없음) · 요금제 줄 「기록」 → 지난 기록 펼침
  두 번 돌아도 통과 — 기록은 지울 수 없어 「시작 뒤」 · 「가장 최근 줄」만 봄. 뜰 때 기록 · 되돌림 · postcheck 파일은 test_v1244_boot(서버에서 직접).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'          # admin@x.com(SUPER)
RPW = 'sgb-test-1234'        # ops@t.local(ADMIN)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
# ── ① 코드 ──────────────────────────────────────────────────────────────
MIG = rd('prisma/migrations/D202_ops_release_log/migration.sql')
RL, OT, CT, LW = (rd('src/modules/admin/release-log.service.ts'), rd('src/modules/admin/owner-todo.service.ts'),
                  rd('src/modules/admin/launch-watch.controller.ts'), rd('src/modules/admin/launch-watch.service.ts'))
ST, DS, EN, DBS, AM, AV = (rd('web/src/app/admin/StateCheck.tsx'), rd('web/src/app/admin/Dashboard.tsx'), rd('src/common/i18n/server-text.en.ts'),
                           rd('src/db/database.service.ts'), rd('src/app.module.ts'), rd('src/common/app-version.ts'))
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
apis = {a for s in SJ.get('screens', []) for a in s.get('apis', [])}
ok('① D202 — ops_release_log(판 · 앞 판 · FIRST · UP · BACK · OTHER · 서버 이름) · 고치기 · 지우기 막음 · 지우는 문장 없음 · 쌓기만 목록',
   'CREATE TABLE IF NOT EXISTS public.ops_release_log' in MIG and "kind IN ('FIRST', 'UP', 'BACK', 'OTHER')" in MIG
   and 'BEFORE DELETE OR UPDATE ON public.ops_release_log' in MIG and 'fn_block_write' in MIG and 'DROP TABLE' not in MIG and 'DELETE FROM' not in MIG
   and "'ops_release_log'" in DBS, '')
ok('① 뜰 때 기록 — onApplicationBootstrap · 같은 판이면 안 적음 · 두 번 적지 않음(NOT EXISTS) · 실패해도 API 는 뜸 · 판 견주기 · 공급자 등록',
   'implements OnApplicationBootstrap' in RL and 'async record(' in RL and 'if (prev === version) return null;' in RL and 'WHERE NOT EXISTS' in RL
   and 'API 는 그대로 뜸' in RL and 'export function releaseKind' in RL and 'export function versionCmp' in AV and 'ReleaseLogService,' in AM, '')
ok('① postcheck 결과 파일 — DATA_DIR(기본 ~/sgb-data)/logs · 이름 형식만 · 가장 최근 · 통과 · 실패 · 확인 · 같음 · 바뀜 · 읽기만(쓰기 없음)',
   "PC_FILE = /^postcheck_" in RL and "'sgb-data'" in RL and '적용 후 확인 — 통과' in RL and '같음 (\\d+)개 · 바뀜 (\\d+)개' in RL
   and 'writeFileSync' not in RL and 'appendFileSync' not in RL, '')
ok('① API — GET releases · GET owner-todo/marks(OWNER_TODO_KEY) · 명세 · 영어',
   "@Get('releases')" in CT and "@Get('owner-todo/marks')" in CT and 'async marks(key: unknown)' in OT
   and {'GET /admin/launch-watch/releases', 'GET /admin/launch-watch/owner-todo/marks'} <= apis
   and '"직접 확인 줄(요금제 · 법무 · EBS)만 볼 수 있습니다."' in EN, '')
ok('① 하루 요약 — 대표 할 일 줄 · 운영 판 줄(실패해도 요약은 그대로)',
   'await this.todo.digestLine().catch(' in LW and 'await this.releases.digestLine().catch(' in LW and 'async digestLine()' in OT and 'async digestLine()' in RL, '')
ok('① 화면 — 지금 판 카드(ReleaseLog) · 첫 화면 · 「기록」 펼침(MarkHistory)',
   'export function ReleaseLog()' in ST and 'data-release-log' in ST and '<ReleaseLog />' in DS and 'function MarkHistory' in ST
   and 'data-owner-hist-btn=' in ST and '/admin/launch-watch/owner-todo/marks?key=' in ST and '/admin/launch-watch/releases' in ST, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('383_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 383 · 판 v10.246 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 246), f'{DOC} · {VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
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


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    t0 = psql("SELECT now()")

    # ── ② 지금 판 · 적용 기록 ──
    rl = call('GET', '/admin/launch-watch/releases', None, TS)
    rows = rl.get('rows') or []
    last = psql("SELECT version || '|' || kind FROM ops_release_log ORDER BY id DESC LIMIT 1")
    ok('② 지금 판 = VERSION · 뜬 시각 · 가장 최근 기록 줄 = 지금 판(API 가 뜰 때 적음) · 최근 10줄까지 · 시각 한국',
       (rl.get('now') or {}).get('version') == VER and bool((rl.get('now') or {}).get('startedAt')) and 1 <= len(rows) <= 10
       and rows[0].get('version') == VER and last.split('|')[0] == VER and re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', rows[0].get('at') or '')
       and rows[0].get('kind') in ('FIRST', 'UP', 'BACK', 'OTHER'), f"{rl.get('now')} · {len(rows)}줄 · {rows[:1]} · DB {last}")
    ok('② 점검판에는 postcheck 결과 파일 없음 → null', 'postcheck' in rl and rl.get('postcheck') is None, str(rl.get('postcheck'))[:120])
    ra, rb = call('GET', '/admin/launch-watch/releases', None, TA), call('GET', '/admin/launch-watch/releases', None, TB)
    ok('② ADMIN 도 봄 · 일반 회원 403', ra.get('_err') is None and (ra.get('now') or {}).get('version') == VER and rb.get('_err') == 403, f"{ra.get('_err')} · {rb.get('_err')}")
    up = psql("UPDATE ops_release_log SET host = 'x' WHERE id = (SELECT max(id) FROM ops_release_log)")
    de = psql("DELETE FROM ops_release_log WHERE id = (SELECT max(id) FROM ops_release_log)")
    bad = psql("INSERT INTO ops_release_log (version, kind) VALUES ('v1.0', 'NOPE')")
    n_after = psql(f"SELECT count(*) FROM ops_release_log WHERE booted_at >= '{t0}'")
    ok('② 기록은 고치기 · 지우기 막힘 · 이상한 kind 막힘 · 시험이 줄을 더하지 않음', up.startswith('!') and de.startswith('!') and bad.startswith('!') and n_after == '0',
       f'{up[:40]} · {de[:30]} · {bad[:40]} · 시작 뒤 {n_after}')

    # ── ③ 하루 요약 두 줄 ──
    td = call('GET', '/admin/launch-watch/owner-todo', None, TS)
    dg = call('GET', '/admin/launch-watch/digest', None, TS).get('text') or ''
    tl = next((l for l in dg.splitlines() if l.startswith('대표 할 일 끝남 ')), '')
    left = [r for r in td.get('rows', []) if r.get('done') is not True]
    want = [r['label'] + ('(직접 확인)' if r.get('done') is None else '') for r in left[:5]]
    ok('③ 하루 요약 「대표 할 일 끝남 n / 15 · 아직: 앞 5줄(외 n)」 — owner-todo 와 맞음',
       tl.startswith(f"대표 할 일 끝남 {td.get('done')} / {td.get('total')}") and td.get('total') in (15, 19)   # v10.284 (D212) 4줄 더함
       and ((not left and '모두 끝남' in tl) or (all(w in tl for w in want) and ((f' 외 {len(left) - 5}' in tl) if len(left) > 5 else ' 외 ' not in tl))), tl[:200])
    vl = next((l for l in dg.splitlines() if l.startswith('운영 판 ')), '')
    ok('③ 하루 요약 「운영 판 … · 마지막 바뀜 MM-DD HH:MI(…)」', vl.startswith(f'운영 판 {VER} · 마지막 바뀜 ') and re.search(r'\d{2}-\d{2} \d{2}:\d{2}\((첫 기록|올림|되돌림|바뀜)', vl) is not None, vl[:160])

    # ── ④ 「적기」 지난 기록 ──
    h0 = call('GET', '/admin/launch-watch/owner-todo/marks?key=plans', None, TS)
    m1 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': True, 'note': '시험 1244 기록 하나'}, TS)
    time.sleep(1)
    m2 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': False, 'note': '시험 1244 기록 둘(다시 아직)'}, TS)
    h1 = call('GET', '/admin/launch-watch/owner-todo/marks?key=plans', None, TS)
    r1 = (h1.get('rows') or [{}])
    ok('④ 두 번 적으면 전체 +2 · 맨 위가 가장 최근(다시 아직 · 메모 · 누가 · 시각) · 둘째가 끝남 · 20줄 넘지 않음',
       m1.get('ok') is True and m2.get('ok') is True and h1.get('key') == 'plans' and h1.get('total') == (h0.get('total') or 0) + 2
       and r1[0].get('done') is False and r1[0].get('note') == '시험 1244 기록 둘(다시 아직)' and bool(r1[0].get('by'))
       and re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', r1[0].get('at') or '') and len(r1) > 1 and r1[1].get('note') == '시험 1244 기록 하나' and r1[1].get('done') is True
       and len(r1) <= 20, f"{h0.get('total')} → {h1.get('total')} · {r1[:2]}")
    e1 = call('GET', '/admin/launch-watch/owner-todo/marks?key=channels', None, TS)
    e2 = call('GET', '/admin/launch-watch/owner-todo/marks', None, TS)
    ha = call('GET', '/admin/launch-watch/owner-todo/marks?key=plans', None, TA)
    hb = call('GET', '/admin/launch-watch/owner-todo/marks?key=plans', None, TB)
    ok('④ 자동 줄 · 빈 key → 422 OWNER_TODO_KEY · ADMIN 도 봄 · 일반 회원 403',
       e1.get('_err') == 422 and e1.get('code') == 'OWNER_TODO_KEY' and e2.get('_err') == 422 and e2.get('code') == 'OWNER_TODO_KEY'
       and ha.get('_err') is None and ha.get('total') == h1.get('total') and hb.get('_err') == 403,
       f"{e1.get('_err')} {e1.get('code')} · {e2.get('_err')} {e2.get('code')} · {ha.get('_err')} · {hb.get('_err')}")

    # ── ⑤ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b_ = p.chromium.launch()
            pg = b_.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            card = pg.locator('[data-release-log]')
            seen = (card.count(), card.get_attribute('data-release-now') if card.count() else None,
                    int(card.get_attribute('data-release-rows') or 0) if card.count() else 0,
                    pg.locator('[data-release-postcheck]').get_attribute('data-release-postcheck') if card.count() else None)
            pg.click('[data-owner-hist-btn="plans"]'); pg.wait_for_timeout(2000)
            hist = pg.locator('[data-owner-hist="plans"] li')
            hn, h1t = hist.count(), (hist.first.inner_text() if hist.count() else '')
            b_.close()
        ok('⑤ 첫 화면 — 지금 판 카드(판 · 기록 줄 · 결과 파일 없음) · 요금제 「기록」 → 지난 기록(맨 위 가장 최근) · 화면 오류 없음',
           seen[0] == 1 and seen[1] == VER and seen[2] >= 1 and seen[3] == 'none' and hn >= 2 and '시험 1244 기록 둘' in h1t and '다시 아직' in h1t and not errs,
           f'{seen} · {hn} · {h1t[:80]} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
