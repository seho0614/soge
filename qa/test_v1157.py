"""v10.157 시험 — 운영 화면 「약관」 고치기(새 판 저장 · 바뀐 곳 보기) · 게시 · 보관된 판 잠금(D150 · docs/239)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1157.py

  ① 코드 — D150(트리거 · 고치기 전용 sgb.terms_fix · 지우는 문장 없음 · 188) · 초안 저장 API(TERM_LOCKED · TERM_VERSION · holes) · 문서 ·
     운영 화면(고치기 · 판 번호 · 〔미확정〕 목록 · 바뀐 곳 보기 · 저장) · 영어 사전 · fixture.sql · docs/239 · 판
  ② (DB · 거래 안에서 되돌림) 게시된 판 본문 · 제목 · 판 번호 · 필수 여부 바꾸기 → TERM_LOCKED · 상태만 바꾸기는 됨 · 초안 → 게시하며 〔시행일〕 채우기는 됨 ·
     sgb.terms_fix = on 거래에서만 고칠 수 있음
  ③ (API) 게시된 판 번호로 저장 → 422 TERM_LOCKED(본문 그대로) · 판 번호 형식 422 TERM_VERSION · 새 판 저장(법무 검토 · holes) · 같은 초안 다시 저장 · ADMIN 403 · 감사 TERM_DRAFT · 되돌림
  ④ (운영 화면) 게시된 줄 「고치기」 → 새 판 번호 제안 · 고치기 전 저장 잠김 · 고치면 바뀐 곳 보기 · 저장 → 새 판(법무 검토) · 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D150_terms_published_lock/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D150 — 게시 · 보관 판 잠금 트리거(BEFORE UPDATE) · TERM_LOCKED · sgb.terms_fix · 지우는 문장 없음 · 188 이상',
   'CREATE OR REPLACE FUNCTION public.fn_terms_published_lock() RETURNS trigger' in D and "OLD.status IN ('PUBLISHED', 'ARCHIVED')" in D
   and 'NEW.body IS DISTINCT FROM OLD.body' in D and 'NEW.version IS DISTINCT FROM OLD.version' in D and "RAISE EXCEPTION 'TERM_LOCKED:" in D
   and "current_setting('sgb.terms_fix', true)" in D and 'CREATE TRIGGER trg_terms_published_lock BEFORE UPDATE ON public.terms' in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP COLUMN|TRUNCATE)\b', D) and len(mig) >= 188 and 'D150_terms_published_lock' in mig, f'{len(mig)} · {mig[-1]}')
TS = rd('src/modules/catalog/terms.service.ts'); TC = rd('src/modules/catalog/terms.controller.ts')
up = TS.split('async upsertDraft')[1].split('async publish')[0] if 'async upsertDraft' in TS else ''
ok('① 초안 저장 API — 게시 · 보관 판 TERM_LOCKED · 판 번호 TERM_VERSION · 응답 holes · 문서 422',
   "new PolicyViolation('TERM_LOCKED'" in up and "new PolicyViolation('TERM_VERSION'" in up and 'holes: TermsService.holes(dto.body).length' in up
   and 'TERM_LOCKED' in TC and 'TERM_VERSION' in TC, '')
TP = rd('web/src/app/admin/TermsPanel.tsx')
ok('① 운영 화면 — 고치기 · 판 번호(새 판 제안) · 제목 · 본문 · 〔미확정〕 목록 · 같은 판 막음 · 바뀐 곳 보기 · 저장(PUT) · 확인 창',
   all(x in TP for x in ('data-term-edit', 'data-term-ver', 'data-term-title', 'data-term-text', 'data-term-edit-holes', 'data-term-clash', 'data-term-diff-btn',
                         'data-term-diff', 'data-term-save', 'function nextVersion', 'function lineDiff', "method: 'PUT'", '`/admin/terms/${e.code}`')), '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 사전 — 새 안내 글 3개(서버 2 · DB 1)', all(x in EN for x in ('"판 번호는 1.1 처럼 숫자와 점으로 적으십시오."', '"게시되었거나 보관된 판({0})은 고칠 수 없습니다 — 새 판 번호로 저장하십시오."',
                                                                  '"게시되었거나 보관된 약관 판({0} {1})은 고칠 수 없습니다 — 새 판 번호로 저장하십시오"')), '')
FX = rd('scripts/fixture.sql')
ok('① fixture.sql — 검정 DB 약관 맞추기는 sgb.terms_fix 로(세션 처음)', "SET sgb.terms_fix = 'on';" in FX and FX.index("SET sgb.terms_fix = 'on';") < FX.index('UPDATE terms'), '')
D239 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('239_')), '')
ok('① docs/239 — 고치기 · TERM_LOCKED · D150 · sgb.terms_fix · 하지 말 것', all(x in D239 for x in ('고치기', 'TERM_LOCKED', 'D150', 'sgb.terms_fix', '하지 말 것')), '')
ok('① 판 v10.157 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 157), rd('VERSION').strip())


# ── ② ~ ④ ────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def tx(*sqls):
    """거래 안에서 돌리고 되돌림 — (마지막 결과 줄, 오류 글)"""
    args = ['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'BEGIN;']
    for s_ in sqls: args += ['-c', s_]
    args += ['-c', 'ROLLBACK;']
    r = subprocess.run(args, capture_output=True, text=True)
    out = [x for x in r.stdout.strip().splitlines() if x]
    return (out[-1] if out else ''), r.stderr.strip()


SELLER = 'seller@x.com'
CODE = 'MARKETING_NIGHT'
if API and DB:
    pv = psql(f"SELECT version FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    md5 = lambda v: psql(f"SELECT md5(body || title || is_required::text) FROM terms WHERE code = '{CODE}' AND version = '{v}'")
    h0 = md5(pv) if pv else ''
    W = f"WHERE code = '{CODE}' AND version = '{pv}'"
    # ② DB
    if pv:
        _, e1 = tx(f"UPDATE terms SET body = body || 'x' {W};")
        _, e2 = tx(f"UPDATE terms SET title = title || 'x' {W};")
        _, e3 = tx(f"UPDATE terms SET version = '8.8' {W};")
        _, e4 = tx(f"UPDATE terms SET is_required = NOT is_required {W};")
        ok('② 게시된 판의 본문 · 제목 · 판 번호 · 필수 여부 바꾸기 → TERM_LOCKED', all('TERM_LOCKED' in e for e in (e1, e2, e3, e4)), e1[:90])
        s5, e5 = tx(f"UPDATE terms SET blocked_by = '시험', display_order = display_order {W};", f"SELECT blocked_by FROM terms {W};")
        ok('② 상태 밖의 칸(막힌 까닭 · 표시 순서)은 바꿀 수 있음', s5 == '시험' and not e5, e5[:90])
        s6, e6 = tx("SET LOCAL sgb.terms_fix = 'on';", f"UPDATE terms SET body = body || E'\\n정정' {W};", f"SELECT right(body, 2) FROM terms {W};")
        ok('② sgb.terms_fix = on 거래에서만 고칠 수 있음(사람이 DB 를 직접 고칠 때)', s6 == '정정' and not e6, e6[:90])
    else:
        print(f'  (점검판에 게시된 {CODE} 가 없음 — ② 일부 건너뜀)')
    s7, e7 = tx(f"INSERT INTO terms (code, version, title, body, is_required, effective_from, status, display_order) SELECT code, '9.8', title, E'# 시험\\n\\n이 약관은 〔시행일〕부터 시행합니다. 본문은 오십 자를 넘기려고 길게 적습니다.', is_required, 'infinity', 'LEGAL_REVIEW', display_order FROM terms WHERE code = '{CODE}' LIMIT 1;",
                f"UPDATE terms SET status = 'PUBLISHED', effective_from = now() + interval '3 days', body = replace(body, '〔시행일〕', '2099-01-01') WHERE code = '{CODE}' AND version = '9.8';",
                f"SELECT status || '|' || (body LIKE '%2099-01-01부터%')::text FROM terms WHERE code = '{CODE}' AND version = '9.8';")
    ok('② 초안 → 게시하며 〔시행일〕 채우기는 그대로 됨(OLD 가 초안)', s7 == 'PUBLISHED|true' and not e7, f'{s7} {e7[:90]}')

    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    title = psql(f"SELECT title FROM terms WHERE code = '{CODE}' LIMIT 1")
    body_h = '# 시험 약관\n\n제1조 이 약관은 시험용입니다. 〔확인 필요〕 칸이 남아 있습니다.\n\n부칙 이 약관은 〔시행일〕부터 시행합니다.'
    try:
        # ③ API
        if pv:
            r1 = call('PUT', f'/admin/terms/{CODE}', {'version': pv, 'title': title, 'body': body_h}, T_)
            ok('③ 게시된 판 번호로 저장 → 422 TERM_LOCKED · 본문 그대로', r1.get('code') == 'TERM_LOCKED' and md5(pv) == h0, str(r1)[:100])
        r2 = call('PUT', f'/admin/terms/{CODE}', {'version': '1.x', 'title': title, 'body': body_h}, T_)
        ok('③ 판 번호 형식 → 422 TERM_VERSION', r2.get('code') == 'TERM_VERSION', str(r2)[:100])
        r3 = call('PUT', f'/admin/terms/{CODE}', {'version': '9.9', 'title': title, 'body': body_h}, T_)
        r4 = call('PUT', f'/admin/terms/{CODE}', {'version': '9.9', 'title': title, 'body': body_h.replace('〔확인 필요〕 칸이 남아 있습니다', '빈칸은 없습니다')}, T_)
        row = psql(f"SELECT status || '|' || (body LIKE '%빈칸은 없습니다%')::text FROM terms WHERE code = '{CODE}' AND version = '9.9'")
        ok('③ 새 판 저장(법무 검토 · holes 1) → 같은 초안 다시 저장(holes 0)', r3.get('status') == 'LEGAL_REVIEW' and r3.get('holes') == 1 and r4.get('holes') == 0
           and row == 'LEGAL_REVIEW|true', f'{r3} · {r4} · {row}')
        ra = call('PUT', f'/admin/terms/{CODE}', {'version': '9.9', 'title': title, 'body': body_h}, TA)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'TERM_DRAFT' AND occurred_at > now() - interval '5 minutes'")
        ok('③ 운영(ADMIN) 403 · 감사 TERM_DRAFT', ra.get('_err') == 403 and aud not in ('', '0'), f"{ra.get('_err')} · 감사 {aud}")
    finally:
        psql(f"DELETE FROM terms WHERE code = '{CODE}' AND version = '9.9' AND status <> 'PUBLISHED'")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
    ok('②③ 되돌림 — 시험 판 없음 · 게시된 판 글 그대로', psql(f"SELECT count(*) FROM terms WHERE code = '{CODE}' AND version IN ('8.8', '9.8', '9.9')") == '0'
       and (not pv or md5(pv) == h0), '')

# ── ④ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB and DB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    pv = psql(f"SELECT version FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    if sync_playwright and pv:
        nv = ''
        before = set(psql(f"SELECT string_agg(version, ',') FROM terms WHERE code = '{CODE}'").split(','))
        with sync_playwright() as p:
            b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1400, 'height': 1000})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.on('dialog', lambda d: d.accept())
            try:
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                pg.goto(ADMIN_WEB + '/#/siteinfo', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-terms-panel]')
                box.locator(f'[data-term-row="{CODE}:{pv}"] [data-term-edit]').click(); pg.wait_for_timeout(500)
                ed = box.locator(f'[data-term-editor="{CODE}:{pv}"]')
                nv = ed.locator('[data-term-ver]').input_value() if ed.count() else ''
                locked = ed.locator('[data-term-save]').is_disabled() if ed.count() else False
                ok('④ 게시된 줄 「고치기」 → 편집 칸 · 새 판 번호 제안(게시 판과 다름) · 고치기 전 저장 잠김', ed.count() == 1 and nv and nv != pv and nv not in before and locked, f'{pv} → {nv}')
                ta = ed.locator('[data-term-text]')
                ta.fill(ta.input_value() + '\n시험으로 더한 줄 T1157')
                ed.locator('[data-term-diff-btn]').click(); pg.wait_for_timeout(300)
                plus = ed.locator('[data-diff-line="+"]').count()
                ok('④ 고치면 바뀐 곳 보기 — 더한 줄 표시 · 〔미확정〕 수 표시', plus >= 1 and ed.locator('[data-term-edit-holes]').count() == 1, f'+ {plus}')
                box.scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(HERE, 'v1157_terms_edit.png'), full_page=False)
                ed.locator('[data-term-save]').click(); pg.wait_for_timeout(2000)
                got = psql(f"SELECT status || '|' || (body LIKE '%T1157%')::text FROM terms WHERE code = '{CODE}' AND version = '{nv}'")
                res = box.locator('[data-terms-result="ok"]').count()
                ok('④ 저장 → 새 판(법무 검토 · 고친 글) · 게시 판 그대로 · 결과 글 · 화면 오류 없음', got == 'LEGAL_REVIEW|true' and res == 1 and not errs
                   and psql(f"SELECT status FROM terms WHERE code = '{CODE}' AND version = '{pv}'") == 'PUBLISHED', f'{got} · {errs[:1]}')
            finally:
                b_.close()
                if nv and nv not in before:
                    psql(f"DELETE FROM terms WHERE code = '{CODE}' AND version = '{nv}' AND status <> 'PUBLISHED'")
        ok('④ 되돌림 — 화면에서 만든 판 지움', set(psql(f"SELECT string_agg(version, ',') FROM terms WHERE code = '{CODE}'").split(',')) == before, '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
