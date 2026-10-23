"""v10.71 시험 — 자동검수 점검 ③ 금칙어 범위 · 낱말 일치 · 첫 등록 · 반려 이력 · 정책 값(D108 · docs/127)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1071.py

  ① D108 — 함수 · 트리거 · 판정 함수는 D107 에서 세 곳만 바뀜 · 재실행 안전 · 자료를 지우지 않음 · 146개
  ② 서버 — 검수 화면 · 수정 화면이 DB 판정 함수를 씀 · 정책 0 표시 · 바꾼 사람 · 쓰지 않는 updatePolicy 지움 · import
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림 — 칸별 차단 · 바뀐 칸만 · 요청 · 낱말 일치 · 주의 단어 · 첫 등록 · 반려 이력 · 정책 범위
"""
import os, re, subprocess

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D108_review_rules_cleanup/migration.sql')
P7 = rd('prisma/migrations/D107_review_identity_basis/migration.sql')
fn = lambda s: (lambda x: x[:x.find('END $$;') + 7])(s[s.find('CREATE OR REPLACE FUNCTION public.fn_auto_review_reasons'):])
f7, f8 = fn(P7), fn(M)
strip = lambda s: re.sub(r'\n  -- D108[^\n]*(\n  --[^\n]*)*', '', s)
x7 = f7.replace("""    FROM fn_check_banned_words(
           coalesce(l.title,'') || ' ' || coalesce(l.body,''), l.gwan_code) w""", "    FROM fn_check_banned_words(@TEXT@, l.gwan_code) w")
x7 = x7.replace("          AND x.id <> l.id AND x.status = 'PUBLISHED'", "@FIRST@")
x7 = x7.replace("     WHERE x.submitted_by = l.owner_account_id AND x.status = 'REJECTED';", "@REJ@")
x8 = strip(f8).replace("    FROM fn_check_banned_words(fn_text_of(to_jsonb(l), fn_listing_text_keys()), l.gwan_code) w", "    FROM fn_check_banned_words(@TEXT@, l.gwan_code) w")
x8 = x8.replace("          AND x.published_at IS NOT NULL", "@FIRST@")
x8 = re.sub(r"     WHERE x\.submitted_by = l\.owner_account_id AND x\.status = 'REJECTED'\n       AND x\.target_type = 'LISTING'\n       AND coalesce\(x\.decided_at, x\.submitted_at\) > now\(\) - make_interval\(days => coalesce\(pol\.num_value, 90\)::int\);", "@REJ@", x8)
ok('① 판정 함수 — D107 에서 세 곳(글 칸 · 첫 등록 · 반려 이력)만 바뀜', f8 and x7 == x8 and x7.count('@') == 6, '')
ok('① 함수 · 트리거', all(x in M for x in ('FUNCTION public.fn_text_of', 'FUNCTION public.fn_listing_text_keys', 'FUNCTION public.fn_listing_text(l public.listings)',
   'FUNCTION public.fn_word_norm', 'FUNCTION public.fn_check_banned_words', 'FUNCTION public.fn_enforce_banned_words', 'FUNCTION public.fn_auto_review_policy_guard',
   'CREATE TRIGGER trg_auto_review_policy_guard')), '')
ok('① 낱말 일치 · 정규식 안전 맞춤 그대로', "WHEN 'EXACT'    THEN position(fn_word_norm(b.word) in fn_word_norm(p_text)) > 0" in M and "WHEN 'REGEX'    THEN fn_regex_hit(p_text, b.word)" in M, '')
ok('① 차단 — 새로 넣을 때 전부 · 고칠 때 바뀐 칸만', "WHERE j ? k AND (o IS NULL OR (j -> k) IS DISTINCT FROM (o -> k))" in M, '')
body = re.sub(r'--[^\n]*', '', M)
ok('① 재실행 안전 · 자료를 지우지 않음', 'DROP TRIGGER IF EXISTS trg_auto_review_policy_guard' in body and not re.search(r'\bDELETE\b|\bDROP TABLE\b|\bDROP FUNCTION\b|\bTRUNCATE\b', body)
   and body.count('IS DISTINCT FROM') >= 2 and "WHERE key = 'manual_after_reject' AND num_value IS NULL" in body, '')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마지막 마이그레이션 D108 · 146개(v10.78 부터 D109 · 147 — test_v1078)', (mig[-1], len(mig)) in (('D108_review_rules_cleanup', 146), ('D109_audit_burst_actor', 147), ('D110_comment_report', 148), ('D111_search_synonym_expand', 149)), f'{mig[-1]} · {len(mig)}')
R = rd('src/modules/review/review.service.ts'); E = rd('src/modules/listing/listing-edit.controller.ts'); C = rd('src/modules/catalog/catalog.service.ts'); G = rd('src/engines/review/auto-review.engine.ts')
ok('② 검수 화면 · 수정 화면 — DB 판정 함수 · 매물 글 칸 모두', 'FROM fn_check_banned_words($1, $2) w' in R and 'fn_listing_text(l)' in R and "ILIKE '%' || word" not in R
   and 'fn_check_banned_words(fn_listing_text(l), l.gwan_code) w' in E and 'position(lower(b.word)' not in E, '')
ok('② 정책 — 0 표시 · 바꾼 사람 · import', 'numValue: p.num_value != null ? Number(p.num_value) : null' in C and 'updated_by = $4' in C and 'RequestCtx.actorId()' in C
   and "import { RequestCtx } from '../../core/request-context';" in C, '')
ok('② 쓰지 않는 updatePolicy 지움', 'async updatePolicy(' not in G and 'AUTO_REVIEW_POLICY_UPDATE' not in G, '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    L = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY id LIMIT 1")[1]
    REP, ORI = 'SET LOCAL session_replication_role = replica; ', 'SET LOCAL session_replication_role = origin; '
    def blocked(sql):
        rc, out, err = psql(f'BEGIN; {sql}; ROLLBACK;')
        return rc != 0 and 'BANNED_WORD:' in err, (err or out)[:100]
    for col, val in (('summary', "'원금보장 상품'"), ('region_detail', "'원금보장'"), ('contact_hours', "'원금보장'"), ('biz_info', """'{"desc":"원금보장"}'::jsonb""")):
        b, d = blocked(f"UPDATE listings SET {col} = {val} WHERE id = '{L}'")
        ok(f'③ 매물 {col} 에 차단 금칙어 → 막힘', b, d)
    rc, out, err = psql(f"BEGIN; {REP} UPDATE listings SET body = '원금보장 예전 글' WHERE id = '{L}'; {ORI} UPDATE listings SET title = title || ' 시험' WHERE id = '{L}'; UPDATE listings SET status = status WHERE id = '{L}'; SELECT 'ok'; ROLLBACK;")
    ok('③ 예전 글에 금칙어가 있어도 다른 칸 · 상태를 고치면 막히지 않음(바뀐 칸만)', rc == 0 and out.endswith('ok'), (err or out)[:100])
    b, d = blocked(f"{REP} UPDATE listings SET body = '원금보장 예전 글' WHERE id = '{L}'; {ORI} UPDATE listings SET body = body || ' 확정수익' WHERE id = '{L}'")
    ok('③ 금칙어가 든 칸을 고치면 막힘', b, d)
    R1 = psql("SELECT id FROM requests ORDER BY id LIMIT 1")[1]
    if R1:
        b, d = blocked(f"UPDATE requests SET title = '원금보장 요청' WHERE id = '{R1}'")
        rc, out, err = psql(f"BEGIN; UPDATE requests SET title = title || ' 시험' WHERE id = '{R1}'; SELECT 'ok'; ROLLBACK;")
        ok('③ 요청 — 금칙어 막힘 · 요청에 없는 칸은 건너뜀', b and rc == 0, d)
    # 낱말은 이미 있는 「포함」 금칙어(예: 사채)가 들어 있지 않은 것으로
    b1, d1 = blocked(f"INSERT INTO banned_words(word, match_type, severity) VALUES ('점검낱말', 'EXACT', 'BLOCK'); UPDATE listings SET body = '점검낱말, 대출 안내' WHERE id = '{L}'")
    rc, out, err = psql(f"BEGIN; INSERT INTO banned_words(word, match_type, severity) VALUES ('점검낱말', 'EXACT', 'BLOCK'); UPDATE listings SET body = '점검낱말업 안내' WHERE id = '{L}'; SELECT 'ok'; ROLLBACK;")
    ok('③ 낱말 일치 — 「점검낱말, 대출」 막힘 · 「점검낱말업」 통과', b1 and rc == 0, (d1 + ' | ' + (err or out))[:160])
    def reasons(pre):
        rc, out, err = psql(f"BEGIN; {pre} INSERT INTO review_items(target_type, target_id, gwan_code, submitted_by, sla_due_at) "
                            f"SELECT 'LISTING', id, gwan_code, owner_account_id, now() + interval '1 day' FROM listings WHERE id = '{L}'; "
                            f"SELECT coalesce(array_to_string(manual_reasons, ','), '') FROM review_items WHERE target_id = '{L}' AND target_type = 'LISTING' ORDER BY submitted_at DESC LIMIT 1; ROLLBACK;")
        return rc, out.split('\n')[-1] if out else '', err
    rc, out, err = reasons(f"INSERT INTO banned_words(word, match_type, severity) VALUES ('점검주의', 'CONTAINS', 'WARN'); UPDATE listings SET summary = '점검주의 요약' WHERE id = '{L}';")
    ok('③ 요약의 주의 단어 → 자동검수 「주의 단어」', rc == 0 and 'BANNED_WORD_WARN' in out, (out or err)[:100])
    own = f"(SELECT owner_account_id FROM listings WHERE id = '{L}')"
    rc, out, err = reasons('')
    ok('③ 노출된 적 있는 회원 → 첫 등록 아님', rc == 0 and 'FIRST_LISTING' not in out, (out or err)[:100])
    rc, out, err = reasons(f"{REP} UPDATE listings SET published_at = NULL WHERE owner_account_id = {own}; {ORI}")
    ok('③ 한 번도 노출된 적 없음 → 첫 등록', rc == 0 and 'FIRST_LISTING' in out, (out or err)[:100])
    def rej(days, ttype='LISTING'):
        return (f"{REP} INSERT INTO review_items(target_type, target_id, gwan_code, submitted_by, sla_due_at, status, decided_at, reject_reason_code) "
                f"SELECT '{ttype}', gen_random_uuid(), gwan_code, owner_account_id, now(), 'REJECTED', now() - interval '{days} days', (SELECT code FROM review_reason_codes ORDER BY code LIMIT 1) FROM listings WHERE id = '{L}'; {ORI}")
    r10, r100, rb = reasons(rej(10)), reasons(rej(100)), reasons(rej(10, 'LISTING_BADGE'))
    ok('③ 반려 이력 — 매물 10일 전 걸림 · 100일 전 안 걸림 · 배지 반려 안 걸림', 'PRIOR_REJECT' in r10[1] and 'PRIOR_REJECT' not in r100[1] and 'PRIOR_REJECT' not in rb[1],
       f'{r10[1]} | {r100[1]} | {rb[1]} {r10[2][:60]}')
    rc, out, err = psql("BEGIN; UPDATE auto_review_policies SET num_value = 150 WHERE key = 'sample_audit_rate'; ROLLBACK;")
    rc2, out2, err2 = psql("BEGIN; UPDATE auto_review_policies SET num_value = 0 WHERE key = 'sample_audit_rate'; SELECT num_value FROM auto_review_policies WHERE key = 'sample_audit_rate'; ROLLBACK;")
    ok('③ 정책 범위 — 표본 150% 막힘(POLICY_VALUE) · 0 은 됨', rc != 0 and 'POLICY_VALUE:' in err and rc2 == 0, (err or out)[:120])
    rc, out, err = psql("SELECT num_value::int, description FROM auto_review_policies WHERE key = 'manual_after_reject'")
    ok('③ 반려 이력 정책 — 90일 · 설명', out.startswith('90|') and '배지 반려는 빼고' in out, out[:100])
else:
    print('     (DB 없음 — ③ 건너뜀 · DB=postgresql://sgb:sgb@localhost:15432/sgb 로 점검판에서)')
ok('VERSION v10.71 이상', re.match(r'v10\.(7[1-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
