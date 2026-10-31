"""v10.159 시험 — 운영 화면에서 약관 새 판을 게시하면 기존 회원이 재동의하는지(처음부터 끝까지 · docs/243)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1159.py

  ① 코드 — 동의할 약관(/terms/required)은 게시된 판만 · 판이 같아야 동의로 셈 · 로그인 뒤 동의 화면으로 · 게시하면 앞 판 보관 · 동의 기록은 고치거나 지우지 못함
  ② (API) 회원이 이용약관에 동의 → SUPER 가 운영 화면 API 로 새 판 9.8 저장 · 게시(내일 시행) → 그 회원은 「동의 안 함 · 옛 판에 동의함」 ·
     필수 미동의 보기(v_term_not_agreed)에 나옴 · 앞 판 보관 · 앞 판 본문 그대로 · 옛 동의 기록 그대로
  ③ (사용자 웹) 그 회원이 로그인 → 동의 화면(/terms/agree)으로 감 · 이용약관 줄(옛 판 → 9.8) · 체크하고 「동의」 → 다음 화면
  ④ (API · DB) 동의 뒤 /terms/required 동의 · 동의 기록 두 줄(옛 판 · 9.8) · 다른 회원(admin@x.com)도 9.8 미동의로 나옴(모두 재동의)
  ⑤ (v10.159 고침) 「고치기」의 「바뀐 점」이 재동의 화면에 나옴 · 새 판이 앞 판의 대상(파트너만) · 알림(위탁 안내)을 이어받음
  끝에 되돌림 — 점검판에서만 session_replication_role=replica 로 9.8 판 · 9.8 동의 기록을 지우고 앞 판을 다시 게시 상태로
"""
import datetime, hashlib, json, os, re, subprocess, uuid, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'
CODE, NEW = 'SERVICE', '9.8'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
CS = rd('src/modules/catalog/compliance.service.ts'); TS = rd('src/modules/catalog/terms.service.ts')
SS = rd('site/src/lib/session.ts'); MW = rd('site/src/middleware.ts'); AP = rd('site/src/app/terms/agree/page.tsx'); AF = rd('site/src/app/terms/agree/AgreeForm.tsx')
B090 = rd('prisma/migrations/B090_triggers/migration.sql')
req = CS.split('async required()')[1][:1500] if 'async required()' in CS else ''
ok('① /terms/required — 지금 시행 중인 게시 판만(v10.161 v_terms_current) · 판이 같아야 동의 · 옛 판에 동의한 회원은 oldVersion · agreedVersion',
   "FROM v_terms_current t" in req and 'c.agreed AND c.term_version = t.version' in req and '"oldVersion"' in req and '"agreedVersion"' in req, '')
ok('① 사용자 웹 — 로그인 뒤 미동의면 동의 화면 · 로그인이 필요한 화면은 middleware 가 동의 화면으로 · 재동의 줄 · 동의 단추',
   "fetch(BASE + '/terms/required'" in SS and 'reconsent: await needsConsent' in SS and "'/terms/agree'" in MW
   and 'data-reconsent-row' in AP and 'data-agree-term' in AF and 'data-agree-submit' in AF, '')
up = TS.split('async upsertDraft(')[1][:3000] if 'async upsertDraft(' in TS else ''
TP = rd('web/src/app/admin/TermsPanel.tsx'); TD = rd('src/modules/catalog/terms.dto.ts')
ok('① (v10.159) 새 판이 is_notice · audience 를 이어받음 · 바뀐 점(changeNote) 저장 · 운영 화면 「바뀐 점」 칸 · 판 번호 · 목록에 changeNote',
   'SELECT is_required, display_order, is_notice, audience FROM terms' in up and 'is_notice, audience, change_note)' in up and 'dto.changeNote?.trim() || null' in up
   and '@MaxLength(300) changeNote?: string;' in TD and 'change_note AS "changeNote"' in TS and 'data-term-note' in TP and 'data-term-note-warn' in TP
   and 'changeNote: e.note.trim()' in TP and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 159), rd('VERSION').strip())
pub = TS.split('async publish(')[1][:6000] if 'async publish(' in TS else ''
ok('① 게시하면 앞 판 보관(v10.161 — 새 판이 시행된 뒤 fn_terms_archive_due) · 동의 기록은 고치거나 지우지 못함(trg_term_agr_ro · trg_term_agree_ro)',
   "SELECT fn_terms_archive_due() AS n" in pub
   and 'trg_term_agr_ro BEFORE DELETE OR UPDATE ON public.term_agreements' in B090 and 'trg_term_agree_ro BEFORE DELETE ON public.term_agreements' in B090, '')


# ── 도구 ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if t: h['authorization'] = 'Bearer ' + t
    data = json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None)
    try:
        r = urllib.request.urlopen(urllib.request.Request(API + p, method=m, data=data, headers=h), timeout=40); raw = r.read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try: return {'_status': e.code, **json.loads(e.read() or b'{}')}
        except Exception: return {'_status': e.code}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def state(tok):
    lst = call('GET', '/terms/required', t=tok)
    return next((x for x in lst if isinstance(x, dict) and x.get('code') == CODE), {}) if isinstance(lst, list) else {}


def agree_all(tok):
    lst = call('GET', '/terms/required', t=tok)
    items = [{'code': x['code'], 'agreed': True} for x in (lst if isinstance(lst, list) else []) if x.get('isRequired') and not x.get('agreed')]
    if items: call('POST', '/terms/agree', {'items': items}, tok)


if API and DB:
    t0 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    v0, e0 = (t0.split('|') + [''])[:2]
    sha0 = psql(f"SELECT md5(body) FROM terms WHERE code = '{CODE}' AND version = '{v0}'")
    print(f'  점검판 이용약관: {t0 or "(게시 판 없음)"}')
    em = f'rc_{uuid.uuid4().hex[:6]}@t.local'; mpw = 'Sgb-rc-1234!'
    try:
        j = call('POST', '/auth/signup', {'email': em, 'password': mpw, 'name': '재동의 시험', 'agreedTerms': []})
        TM = j.get('accessToken') or call('POST', '/auth/login', {'email': em, 'password': mpw}).get('accessToken')
        agree_all(TM)
        s0 = state(TM)
        T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        agree_all(T_)
        ok('② 시작 — 이용약관 게시 판이 있고 회원은 그 판에 동의함', bool(v0) and s0.get('agreed') is True and s0.get('version') == v0, f'{v0} · {s0}')

        # ② SUPER 가 운영 화면 API 로 새 판 저장 · 게시
        title, body = psql(f"SELECT title FROM terms WHERE code = '{CODE}' AND version = '{v0}'"), \
            psql(f"SELECT body FROM terms WHERE code = '{CODE}' AND version = '{v0}'") + '\n\n<!-- v10.159 재동의 시험 판 -->'
        body = re.sub(r'〔(?!시행일)[^〕]*〕', '', body)
        NOTE = '시험 — 제3조 소개비 문장을 고침'
        r0 = call('PUT', f'/admin/terms/{CODE}', {'version': NEW, 'title': title, 'body': body, 'changeNote': NOTE}, T_)
        # v10.161 — 새 판 시행일은 지금 판 시행일보다 뒤(TERM_DATE_BEFORE_CURRENT) · 점검 자료의 앞 판은 2026-11-11 시행일 수 있음
        tomorrow = (max(datetime.date.fromisoformat(e0[:10]), datetime.date.today()) + datetime.timedelta(days=2)).isoformat()
        r1 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NEW, 'effectiveFrom': tomorrow}, T_)
        # v10.161 (D151) — 내일 시행이면 시행 예정: 앞 판은 시행일까지 게시 그대로 · 회원은 재동의 없이 앞 판 기준 · 바뀔 약관 알림
        sp = state(TM); up = call('GET', '/terms/upcoming')
        st = psql(f"SELECT string_agg(version || ' ' || status, ' · ' ORDER BY version) FROM terms WHERE code = '{CODE}' AND version IN ('{v0}', '{NEW}')")
        ok('② 새 판 9.8 저장 · 게시(내일 시행) → 시행 예정 · 앞 판은 게시 그대로 · 회원 재동의 없음 · /terms/upcoming 에 9.8(v10.161)', r0.get('_status') is None and r1.get('status') == 'PUBLISHED'
           and r1.get('scheduled') is True and st == f'{v0} PUBLISHED · {NEW} PUBLISHED' and sp.get('version') == v0 and sp.get('agreed') is True
           and any(isinstance(u, dict) and u.get('code') == CODE and u.get('version') == NEW and u.get('currentVersion') == v0 and u.get('changeNote') == NOTE for u in (up if isinstance(up, list) else [])),
           f'{str(r1)[:80]} · {st} · {sp} · {str(up)[:120]}')
        # 시행일이 온 것으로(시행일을 1분 전으로) → 매시간 작업과 같은 함수 → 앞 판 보관 · 그때부터 재동의
        psql(f"UPDATE terms SET effective_from = now() - interval '2 days' WHERE code = '{CODE}' AND version = '{v0}'; "
             f"UPDATE terms SET effective_from = now() - interval '1 minute' WHERE code = '{CODE}' AND version = '{NEW}'; SELECT fn_terms_archive_due();")
        s1 = state(TM)
        st = psql(f"SELECT string_agg(version || ' ' || status, ' · ' ORDER BY version) FROM terms WHERE code = '{CODE}' AND version IN ('{v0}', '{NEW}')")
        ok('② 시행일이 지나면 앞 판 보관(fn_terms_archive_due)', st == f'{v0} ARCHIVED · {NEW} PUBLISHED', st)
        ok('② 회원 — 이용약관 「동의 안 함 · 옛 판에 동의함」(oldVersion · agreedVersion=앞 판) · 바뀐 점',
           s1.get('version') == NEW and s1.get('agreed') is False and s1.get('oldVersion') is True and s1.get('agreedVersion') == v0 and s1.get('changeNote') == NOTE, str(s1))
        na = psql(f"SELECT count(*) FROM v_term_not_agreed v JOIN accounts a ON a.id = v.account_id WHERE a.email = '{em}' AND v.code = '{CODE}'")
        ok('② 필수 미동의 보기(v_term_not_agreed)에 그 회원 · 이용약관', na == '1', na)
        sha1 = psql(f"SELECT md5(body) FROM terms WHERE code = '{CODE}' AND version = '{v0}'")
        old = psql(f"SELECT count(*) FROM term_agreements ta JOIN accounts a ON a.id = ta.account_id WHERE a.email = '{em}' AND ta.term_code = '{CODE}' AND ta.term_version = '{v0}' AND ta.agreed")
        ok('② 앞 판 본문 그대로(보관만) · 옛 판 동의 기록 그대로', sha0 and sha1 == sha0 and old == '1', f'{sha0[:8]} → {sha1[:8]} · {old}')

        # ③ 사용자 웹
        if SITE:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); c = b.new_context(viewport={'width': 1300, 'height': 1000}); pg = c.new_page()
                pg.goto(SITE + '/login'); pg.fill('input[name=email]', em); pg.fill('input[name=password]', mpw)
                pg.click('form.auth button'); pg.wait_for_timeout(3000)
                url1 = pg.url
                row = pg.locator(f'[data-reconsent-row="{CODE}"]')
                rt = row.inner_text() if row.count() else ''
                ok('③ 로그인 → 동의 화면(/terms/agree) · 이용약관 줄 옛 판 → 9.8 · 바뀐 점', '/terms/agree' in url1 and v0 in rt and NEW in rt and NOTE in rt, f'{url1} · {rt[:120]!r}')
                for cb in pg.locator('[data-agree-term]').all():
                    if not cb.is_checked(): cb.check()
                pg.click('[data-agree-submit]'); pg.wait_for_timeout(3000)
                ok('③ 체크하고 「동의」 → 동의 화면을 떠남', '/terms/agree' not in pg.url, pg.url)
                b.close()
        else:
            call('POST', '/terms/agree', {'items': [{'code': CODE, 'agreed': True}]}, TM)
            print('  (SITE 없음 — ③ 은 API 로 동의만)')

        # ④ 동의 뒤
        s2 = state(TM)
        rows = psql(f"SELECT string_agg(ta.term_version, ' · ' ORDER BY ta.id) FROM term_agreements ta JOIN accounts a ON a.id = ta.account_id WHERE a.email = '{em}' AND ta.term_code = '{CODE}' AND ta.agreed")
        ok('④ 동의 뒤 — 이용약관 9.8 동의 · 동의 기록 두 줄(옛 판 · 9.8)', s2.get('agreed') is True and s2.get('version') == NEW and rows == f'{v0} · {NEW}', f'{s2} · {rows}')
        sa = state(T_)
        ok('④ 다른 회원(admin@x.com)도 9.8 미동의 — 게시하면 모든 회원이 재동의', sa.get('agreed') is False and sa.get('agreedVersion') == v0, str(sa))
        # ⑤ 새 판이 대상 · 알림을 이어받음(저장만 · 게시 안 함)
        got = {}
        for c in ('PARTNER', 'OUTSOURCE'):
            tt = psql(f"SELECT title FROM terms WHERE code = '{c}' ORDER BY effective_from DESC LIMIT 1")
            bb = re.sub(r'〔(?!시행일)[^〕]*〕', '', psql(f"SELECT body FROM terms WHERE code = '{c}' ORDER BY effective_from DESC LIMIT 1")) + '\n\n<!-- v10.159 시험 -->'
            rr = call('PUT', f'/admin/terms/{c}', {'version': NEW, 'title': tt, 'body': bb}, T_)
            got[c] = psql(f"SELECT audience || '|' || is_notice::text || '|' || coalesce(change_note, '-') FROM terms WHERE code = '{c}' AND version = '{NEW}'") or str(rr)[:80]
        want = {c: psql(f"SELECT audience || '|' || is_notice::text FROM terms WHERE code = '{c}' AND version <> '{NEW}' ORDER BY (status = 'PUBLISHED') DESC, effective_from DESC LIMIT 1") + '|-' for c in got}
        ok('⑤ 새 판 9.8 이 앞 판의 대상 · 알림을 이어받음(파트너 이용약관 PARTNER · 위탁 안내 알림)', got == want and got.get('PARTNER', '').startswith('PARTNER|') and '|true|' in got.get('OUTSOURCE', ''), f'{got} · 기대 {want}')
    finally:
        psql(f"DELETE FROM terms WHERE code IN ('PARTNER', 'OUTSOURCE') AND version = '{NEW}' AND status IN ('DRAFT', 'LEGAL_REVIEW')")
        psql(f"SET session_replication_role = replica; DELETE FROM term_agreements WHERE term_code = '{CODE}' AND term_version = '{NEW}'; "
             f"DELETE FROM terms WHERE code = '{CODE}' AND version = '{NEW}'; SET sgb.terms_fix = 'on'; "
             + (f"UPDATE terms SET status = 'PUBLISHED', effective_from = '{e0}' WHERE code = '{CODE}' AND version = '{v0}';" if v0 else ''))
    t1 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    ok('끝 — 되돌림(9.8 판 · 9.8 동의 기록 없음 · 앞 판 다시 게시 · 본문 그대로)', t1 == t0 and psql(f"SELECT count(*) FROM terms WHERE code = '{CODE}' AND version = '{NEW}'") == '0'
       and psql(f"SELECT md5(body) FROM terms WHERE code = '{CODE}' AND version = '{v0}'") == sha0, f'{t0} → {t1}')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
