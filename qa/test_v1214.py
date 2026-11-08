"""v10.214 (docs/344) — 적용 점검 줄 나누기 · 운영 상태 한눈에 「약관 시행 예정」 줄

  ① (코드) 서비스 terms-upcoming 줄 · AI 줄 「게시됨」 · precheck · postcheck 새 줄(오픈 차단 항목 · 약관 시행 중 · 시행 예정) · docs/321 · 문서 344 · 판
  ② (DB · API) 두 스크립트의 새 SQL 이 그대로 돎 · 시험 판 — T1214 9.9213(시행 중) 뒤 9.9214(5일 뒤) = 「새 판」 · T1215 9.9215(6일 뒤 · 그 약관 첫 판) = 「첫 판 … 게시 때부터 동의 기준」 · 회원 403
  ③ (화면) 첫 화면 「운영 상태 한눈에」에 그 줄 · 끝나면 시험 판 지움(1.0 이 아니라 지울 수 있음 · 두 번 돌려도 같음)
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
CODE, VER, TITLE = 'T1214', '9.9214', '시험 약관 1214'
CODE2, VER2, TITLE2 = 'T1215', '9.9215', '시험 약관 1215'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


SV, PRE, POST = rd('src/modules/admin/state-check.service.ts'), rd('deploy/aws/precheck.sh'), rd('deploy/aws/postcheck.sh')
ok('① 서비스 — 「약관 시행 예정」 줄(terms-upcoming · 약관 초안 빈칸 바로 아래) · 게시 · 시행일 앞(infinity 뺌) · AI 줄 「게시됨」',
   "key: 'terms-upcoming', label: '약관 시행 예정', go: 'terms', state: 'info'" in SV
   and 'FROM v_terms_upcoming' in SV and 'FROM v_terms_current WHERE effective_from > now()' in SV and '게시 때부터 동의 기준' in SV
   and SV.index("key: 'terms',") < SV.index("key: 'terms-upcoming'") < SV.index("key: 'outsource'")
   and '처리방침 게시됨 · AI' in SV and '처리방침이 게시되기 전(AI' in SV and '처리방침 시행 중' not in SV, '')
ok('① postcheck — 오픈 차단 항목 줄 · 약관 「게시 n(시행 중 · 시행 예정 · 가장 빠른)」 · 초안 이름',
   '''qn "select kind || ' ' || item from v_open_blockers order by kind, item" | while IFS= read -r l; do info "오픈 차단 · $l"; done''' in POST
   and 't="$t(시행 중 $tn · 새 판 시행 예정 $tf)"' in POST and "' · 첫 판 시행일 전 '" in POST and 'warn "약관 — 게시 $t · 초안 $dr$dn"' in POST and '약관 — 발행' not in POST, '')
ok('① precheck — 오픈 차단 항목 줄 · 약관 게시(시행 중 · 시행 예정) · 초안',
   '''qn "select kind || ' ' || item from v_open_blockers order by kind, item" | while IFS= read -r l; do info "  · $l"; done''' in PRE
   and 'info "약관: 게시 $(q ' in PRE and '· 새 판 시행 예정 $(q "select count(*) from v_terms_upcoming") · 첫 판 시행일 전 $(q ' in PRE, '')
D321 = rd('docs/321_운영반영절차서_공통_v10.202_20261106.md')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('344_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① docs/321 확인 줄 표 · 문서 344 · 판 v10.214 이상',
   '약관 — 게시 N(시행 중 N · 새 판 시행 예정 N · 첫 판 시행일 전 N · 가장 빠른 MM-DD)' in D321 and '**55 · 0 · 4**' in D321
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 214), f'{DOC} · {rd("VERSION").strip()}')


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


def sqls(src, names):
    """스크립트에서 q "…" 로 부르는 SQL 을 그대로 꺼냄(이번에 더한 것만)."""
    out = []
    for n in names:
        m = re.search(n + r'''=\$\(q "(.+?)"\)\n''', src)
        out.append(m.group(1) if m else '')
    return out


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    # ② 스크립트의 새 SQL 이 점검판 DB 에서 오류 없이 돎(운영에서 처음 도는 줄이라 미리)
    tn, tf, dn = sqls(POST, ['tn', 'tf', 'dn'])
    got = [psql(s) if s else '!없음' for s in (tn, tf, dn, "select kind || ' ' || item from v_open_blockers order by kind, item")]
    ok('② postcheck 새 SQL 4개 — 점검판 DB 에서 그대로 돎(시행 중 수 · 시행 예정 수 · 초안 이름 · 오픈 차단 항목)',
       all(not g.startswith('!') for g in got) and got[0].isdigit() and re.match(r'^\d+ · 첫 판 시행일 전 \d+', got[1] or '') is not None, f'{[g[:60] for g in got]}')
    psql(f"DELETE FROM terms WHERE code IN ('{CODE}', '{CODE2}')")
    try:
        ins = "INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('{0}', '{1}', '{2}', E'## 제1조 시험\\n본문', false, {3}, 'PUBLISHED')"
        r0 = (psql(ins.format(CODE, '9.9213', TITLE, "now() - interval '1 second'")) + psql(ins.format(CODE, VER, TITLE, "now() + interval '5 days'"))
              + psql(ins.format(CODE2, VER2, TITLE2, "now() + interval '6 days'")))
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
        st = call('GET', '/admin/launch-watch/state', None, TA)
        mb = call('GET', '/admin/launch-watch/state', None, TB)
        rows = st if isinstance(st, list) else []
        keys = [r.get('key') for r in rows]
        up = next((r for r in rows if r.get('key') == 'terms-upcoming'), {})
        ai = next((r for r in rows if r.get('key') == 'ai'), {})
        ok('② API — 11줄 · 「약관 시행 예정」이 약관 초안 빈칸 바로 아래 · 값만(info) · 보러 가기 약관 · 회원 403',
           len(rows) == 11 and 'terms' in keys and keys.index('terms-upcoming') == keys.index('terms') + 1
           and up.get('state') == 'info' and up.get('go') == 'terms' and mb.get('_err') == 403, f'{keys} · {mb.get("_err")} · {r0[:80]}')
        un = up.get('now') or ''
        nw, fs = (un.split(' / ') + ['', ''])[:2]
        ok('② 새 판(앞 판 시행 중 · 5일 뒤) → 「새 판 … (5일 뒤) 시험 약관 1214 9.9214 … 그날 앞 판이 바뀜」 · 첫 판(6일 뒤) → 「첫 판 … (6일 뒤) 시험 약관 1215 9.9215 … 동의 기준」',
           nw.startswith('새 판 ') and (f'(5일 뒤) {TITLE} {VER}' in nw or ('(5일 뒤) ' in nw and '종' in nw)) and nw.endswith('그날 앞 판이 바뀜')
           and fs.startswith('첫 판 ') and (f'(6일 뒤) {TITLE2} {VER2}' in fs or ('(6일 뒤) ' in fs and '종' in fs)) and '게시 때부터 동의 기준' in fs
           and VER2 not in nw and VER not in fs, f'{un} · {r0[:80]}')
        ok('② AI 줄 — 「처리방침 게시됨」 · 「게시되기 전」 중 하나(「시행 중」 아님)',
           ('처리방침 게시됨' in (ai.get('now') or '') or '게시되기 전' in (ai.get('now') or '')) and '시행 중' not in (ai.get('now') or ''), f"{ai.get('now')}")

        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            seen, errs = {}, []
            if sync_playwright:
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        row = pg.locator('[data-state-row="terms-upcoming"]')
                        seen['n'] = row.count()
                        seen['text'] = row.inner_text() if row.count() else ''
                        seen['go'] = row.locator('[data-state-go="terms"]').count() if row.count() else 0
                        b.close()
                except Exception as ex:
                    errs.append(str(ex)[:160])
            ok('③ 첫 화면 「운영 상태 한눈에」 — 「약관 시행 예정」 줄 · 새 판 5일 뒤 · 첫 판 6일 뒤 · 보러 가기',
               seen.get('n') == 1 and '약관 시행 예정' in seen.get('text', '') and '5일 뒤' in seen.get('text', '') and '6일 뒤' in seen.get('text', '') and seen.get('go') == 1 and not errs,
               f"{seen} · {errs[:2]}")
    finally:
        psql(f"DELETE FROM terms WHERE code IN ('{CODE}', '{CODE2}')")
    ok('②③ 되돌림 — 시험 판 지움', psql(f"SELECT count(*) FROM terms WHERE code IN ('{CODE}', '{CODE2}')") == '0', '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
