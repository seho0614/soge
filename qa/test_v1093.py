"""v10.93 시험 — 다국어 1단계 기반(D115 · docs/148 · docs/150)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1093.py

  ① 마이그레이션 — 언어 8개(한국어만 켜짐) · 번역 표 제약 · 원문 함수 · 낡음 뷰 · 스위치 3개(꺼짐) · 지우는 문장 없음 · 153 · D115
  ② 서버 · 화면 — API 7개 · 운영 권한 · 감사 기록 · 화면 레지스트리 SB-ADM-TRN-010 · 운영 화면 탭 「번역」 · 손님 화면은 그대로(사이트 코드 안 바뀜)
  ③ (DB) 거래 안에서 — 낡음 · 원문 없음 · 한국어 끄기 막힘 · 한국어 번역 줄 막힘 · 반려 사유 필수
  ④ (API) 넣기 → 승인 → 원문 고침 → 낡음 409 → 다시 넣기 → 승인 · 금칙어 422 · 반려 · 회원 403 · 한국어 끄기 409
"""
import glob, json, os, re, subprocess, urllib.error, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D115_i18n_base/migration.sql')
ok('① 언어 8개 · 한국어만 켜짐 · 아랍어 좌우 반전', len(re.findall(r"^\s+\('[a-z]{2}', ", M, re.M)) == 8 and "('ko', '한국어', '한국어', false, true, 0)" in M and "('ar', '아랍어', 'العربية', true, false, 7)" in M, '')
ok('① 번역 표 — 대상 7종 · 상태 5종 · 한국어 줄 금지 · 반려 사유 · 칸마다 한 줄', all(x in M for x in (
    "target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT')", "status IN ('DRAFT','APPROVED','AUTO_APPROVED','MACHINE','REJECTED')",
    "CHECK (lang <> 'ko')", 'content_translations_reject_reason', 'UNIQUE (target_type, target_id, field, lang)')), '')
ok('① 원문 함수 · 낡음 뷰(md5) · 한국어 끄기 막는 트리거', 'FUNCTION public.fn_i18n_source' in M and 'md5(s.src) <> t.source_hash' in M and 'trg_i18n_lang_guard' in M, '')
ok('① 스위치 3개 꺼짐 · 형식 검사', all(x in M for x in ("('i18n.enabled', 'off'", "'^(on|off)$'", "('i18n.engine', 'MANUAL'", "'^(MANUAL|CLAUDE|N8N)$'", "('i18n.board_on_view', 'off'")), '')
ok('① 지우는 문장 없음 · 재실행 안전(IF NOT EXISTS · ON CONFLICT)', not re.search(r'\b(DELETE|TRUNCATE|DROP TABLE)\b', M) and M.count('ON CONFLICT') == 2 and 'ADD COLUMN IF NOT EXISTS preferred_lang' in M, '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 153 · 마지막 D115(v10.94 부터 D116 · 154 — test_v1094)', (len(mig), mig[-1] if mig else '') in ((153, 'D115_i18n_base'), (154, 'D116_agent_base'), (155, 'D117_i18n_content_overlay'), (156, 'D118_i18n_auto_translate'), (157, 'D119_i18n_board_on_view'), (158, 'D120_ai_review_shadow'), (159, 'D121_agent_chat'), (160, 'D122_agent_key_admin'), (161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff')), f'{len(mig)} · {mig[-1] if mig else ""}')

C = rd('src/modules/i18n/i18n.controller.ts'); S = rd('src/modules/i18n/i18n.service.ts')
routes = re.findall(r"@(Get|Post|Put)\('([^']+)'\)", C)
want = {('Get', 'admin/i18n/langs'), ('Post', 'admin/i18n/langs/:code'), ('Get', 'admin/i18n/translations'), ('Get', 'admin/i18n/source'),
        ('Put', 'admin/i18n/translations'), ('Post', 'admin/i18n/translations/:id/approve'), ('Post', 'admin/i18n/translations/:id/reject')}
ok('② 운영 API 7개(v10.103 원문 목록 GET admin/i18n/catalog 더함) · 모두 운영(ADMIN · SUPER)', want <= set(routes) and C.count("@Roles('ADMIN', 'SUPER')") >= 7
   and all(p.startswith('admin/') or p in ('i18n/langs', 'me/lang') for _, p in routes), str(len(routes)))
ok('② 바꾸는 API 4개에 감사 기록', all(f"@Audit('{x}'" in C for x in ('I18N_LANG_SET', 'I18N_TRANSLATION_SAVE', 'I18N_TRANSLATION_APPROVE', 'I18N_TRANSLATION_REJECT')), '')
ok('② 승인 — 낡음 · 원문 없음 409 · 금칙어 422 · 반려 답에 사유', all(x in S for x in ("'TRANSLATION_STALE'", "'SOURCE_MISSING'", "'BANNED_WORD'", "fn_check_banned_words($1, $2) WHERE severity = 'BLOCK'", "status: 'REJECTED', reason")), '')
ok('② 서비스의 칸 목록 = DB 함수의 칸 목록', all(f"'{t}'" in M for t in ('NOTICE', 'FAQ', 'TERM', 'LISTING', 'REQUEST', 'POST', 'COMMENT')) and "COMMENT: ['body']" in S, '')
ok('② app.module 등록', re.search(r'\bI18nController,', rd('src/app.module.ts')) and re.search(r'\bI18nService,', rd('src/app.module.ts')), '')
scr = json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']
t = [x for x in scr if x['id'] == 'SB-ADM-TRN-010']
ok('② 화면 레지스트리 SB-ADM-TRN-010 — API 7개(+ v10.103 catalog) · 운영 · #/i18n', t and len(t[0]['apis']) >= 7 and t[0]['roles'] == ['ADMIN', 'SUPER'] and t[0].get('bo') == '#/i18n', '')
menu = rd('web/src/lib/adminMenu.ts'); app = rd('web/src/App.tsx'); W = rd('web/src/app/admin/Translations.tsx')
ok('② 운영 화면 — 탭 i18n 「번역」 · 관 관리 묶음 · App 연결', "['i18n', '번역']" in menu and "'siteinfo', 'i18n', 'hlt-products'" in menu and "{tab === 'i18n' && <Translations />}" in app, '')
ok('② 번역 화면 — 목록 · 넣기 · 언어 · 낡음 표시 · 낡은 줄은 승인 단추 없음', all(x in W for x in ('data-i18n-list', 'data-i18n-form', 'data-i18n-langs', "!x.isStale && !x.sourceMissing", '/admin/i18n/source?')), '')
ok('② 손님 화면 API — v10.95(2-1) 부터 i18n/langs · me/lang 두 개만', {p for _, p in routes if not p.startswith('admin/')} <= {'i18n/langs', 'me/lang'}, '')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


if DB:
    rc, out, err = psql("""
BEGIN;
CREATE TEMP TABLE _n AS SELECT gen_random_uuid() AS id;
INSERT INTO notices (id, title, body) SELECT id, '점검 1093 제목', '점검 본문' FROM _n;
INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash) SELECT 'NOTICE', id::text, 'title', 'en', 'Check 1093', md5('점검 1093 제목') FROM _n;
SELECT 'A:' || is_stale || ':' || source_missing FROM v_translation_state v JOIN _n ON v.target_id = _n.id::text;
UPDATE notices SET title = '점검 1093 제목 고침' WHERE id = (SELECT id FROM _n);
SELECT 'B:' || is_stale FROM v_translation_state v JOIN _n ON v.target_id = _n.id::text;
DELETE FROM notices WHERE id = (SELECT id FROM _n);
SELECT 'C:' || source_missing FROM v_translation_state v JOIN _n ON v.target_id = _n.id::text;
ROLLBACK;
""")
    L = out.split('\n')
    ok('③ 원문 그대로 → 낡지 않음 · 원문 고침 → 낡음 · 원문 지움 → 원문 없음', 'A:false:false' in L and 'B:true' in L and 'C:true' in L, out or err[:200])
    for name, sql, needle in (('한국어 끄기 막힘', "UPDATE i18n_langs SET is_active = false WHERE code = 'ko';", 'I18N'),
                              ('한국어 번역 줄 막힘', "INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash) VALUES ('NOTICE', gen_random_uuid()::text, 'title', 'ko', 'x', 'x');", 'content_translations_not_ko'),
                              ('반려는 사유 필수', "INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash, status) VALUES ('NOTICE', gen_random_uuid()::text, 'title', 'en', 'x', 'x', 'REJECTED');", 'content_translations_reject_reason')):
        rc, out, err = psql(f'BEGIN; {sql} ROLLBACK;')
        ok(f'③ {name}', rc != 0 and needle in err, err[:120])
    rc, out, err = psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'")
    ok('③ i18n.enabled = off', out == 'off', out)

if API and DB:
    def call(method, path, tok=None, body=None):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    login = lambda e: call('POST', '/auth/login', body={'email': e, 'password': 'sgb-dev-1234'})[1]['accessToken']
    ADM, MEM = login('admin@x.com'), login(os.environ.get('MEMBER', 'person@x.com'))
    tag = uuid.uuid4().hex[:6]
    rc, nid, err = psql(f"INSERT INTO notices (title, body) VALUES ('점검 번역 {tag}', '점검 번역 본문 {tag}') RETURNING id")
    nid = nid.split('\n')[-1]
    try:
        s0, j0 = call('GET', f'/admin/i18n/source?targetType=NOTICE&targetId={nid}&field=title', ADM)
        ok('④ 원문 보기 200', s0 == 200 and (j0 or {}).get('sourceText') == f'점검 번역 {tag}', f'{s0}')
        s1, j1 = call('PUT', '/admin/i18n/translations', ADM, {'targetType': 'NOTICE', 'targetId': nid, 'field': 'title', 'lang': 'en', 'text': f'Check translation {tag}'})
        tid = (j1 or {}).get('id')
        ok('④ 넣기 → 승인 대기', s1 == 200 and tid and j1.get('status') == 'DRAFT', f'{s1} {j1}')
        s2, j2 = call('POST', f'/admin/i18n/translations/{tid}/approve', ADM)
        s2b, _ = call('POST', f'/admin/i18n/translations/{tid}/approve', ADM)
        ok('④ 승인 200 · 다시 승인 409', s2 in (200, 201) and (j2 or {}).get('status') == 'APPROVED' and s2b == 409, f'{s2} {s2b}')
        psql(f"UPDATE notices SET title = '점검 번역 {tag} 고침' WHERE id = '{nid}'")
        s3, j3 = call('GET', f'/admin/i18n/translations?targetType=NOTICE&stale=true&size=100', ADM)
        row = [x for x in (j3 or {}).get('items', []) if x['id'] == tid]
        ok('④ 원문 고침 → 목록에 낡음', s3 == 200 and row and row[0]['isStale'] is True, f'{s3}')
        s4, _ = call('PUT', '/admin/i18n/translations', ADM, {'targetType': 'NOTICE', 'targetId': nid, 'field': 'title', 'lang': 'en', 'text': f'Check translation {tag} v2'})
        s4b, j4b = call('POST', f'/admin/i18n/translations/{tid}/approve', ADM)
        ok('④ 다시 넣기 → 승인 대기 → 승인', s4 == 200 and s4b in (200, 201) and (j4b or {}).get('status') == 'APPROVED', f'{s4} {s4b}')
        rc, bw, err = psql("SELECT word FROM banned_words WHERE is_active AND severity = 'BLOCK' AND match_type = 'CONTAINS' AND gwan_code IS NULL ORDER BY word LIMIT 1")
        if bw:
            call('PUT', '/admin/i18n/translations', ADM, {'targetType': 'NOTICE', 'targetId': nid, 'field': 'body', 'lang': 'en', 'text': f'body {bw} {tag}'})
            rc, bid, err = psql(f"SELECT id FROM content_translations WHERE target_type = 'NOTICE' AND target_id = '{nid}' AND field = 'body' AND lang = 'en'")
            s5, j5 = call('POST', f'/admin/i18n/translations/{bid}/approve', ADM)
            ok('④ 번역문에 차단 금칙어 → 422 BANNED_WORD', s5 == 422 and (j5 or {}).get('code') == 'BANNED_WORD', f'{s5} {(j5 or {}).get("code")}')
            s6, j6 = call('POST', f'/admin/i18n/translations/{bid}/reject', ADM, {'reason': f'금칙어 {tag}'})
            ok('④ 반려 — 답에 사유', s6 in (200, 201) and (j6 or {}).get('reason') == f'금칙어 {tag}', f'{s6}')
        s7, _ = call('GET', '/admin/i18n/translations', MEM)
        s8, _ = call('PUT', '/admin/i18n/translations', MEM, {'targetType': 'NOTICE', 'targetId': nid, 'field': 'title', 'lang': 'en', 'text': 'x'})
        s9, _ = call('POST', '/admin/i18n/langs/ko', ADM, {'isActive': False})
        s10, _ = call('PUT', '/admin/i18n/translations', ADM, {'targetType': 'NOTICE', 'targetId': nid, 'field': 'nope', 'lang': 'en', 'text': 'x'})
        s11, _ = call('POST', '/admin/i18n/translations/abc/approve', ADM)
        ok('④ 회원 403 · 한국어 끄기 409 · 없는 칸 4xx · 숫자 아닌 번호 404', s7 == 403 and s8 == 403 and s9 == 409 and s10 in (400, 422) and s11 == 404, f'{s7} {s8} {s9} {s10} {s11}')
        s12, j12 = call('GET', '/admin/i18n/langs', ADM)
        ok('④ 언어 목록 — 꺼짐 · MANUAL · 8개', s12 == 200 and j12['enabled'] is False and j12['engine'] == 'MANUAL' and len(j12['items']) == 8, f'{s12}')
    finally:
        psql(f"DELETE FROM content_translations WHERE target_type = 'NOTICE' AND target_id = '{nid}'; DELETE FROM notices WHERE id = '{nid}';")

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.93 이상', _v >= (10, 93), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
