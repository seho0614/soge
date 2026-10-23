"""v10.69 시험 — 자동검수 점검 ① 금칙어 정규식 안전장치(D106 · docs/125)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1069.py

  ① 마이그레이션 D106 — 함수 3개 · 트리거 · 잘못된 줄 끄기 · 재실행 안전 · 자료를 지우지 않음 · 마지막 · 144개
  ② API — 맞춤 방식 · 수위는 정해진 값만(IsIn)
  ③ (DB 가 있으면) 점검판 DB 에서 거래 안에서 시험하고 되돌림
     · 잘못된 REGEX 줄 넣기 → BANNED_REGEX 로 막힘 · 꺼진 채로는 넣을 수 있음 · 다시 켜기는 막힘
     · 트리거를 거치지 않고 들어간 잘못된 줄이 있어도 매물 수정 · 검수 넣기가 멈추지 않음
     · 맞는 REGEX 는 그대로 걸림(차단)
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


M = rd('prisma/migrations/D106_banned_regex_guard/migration.sql')
ok('① D106 — 함수 3개 · 트리거', all(x in M for x in ('FUNCTION public.fn_is_valid_regex', 'FUNCTION public.fn_regex_hit', 'FUNCTION public.fn_check_banned_words',
   'FUNCTION public.fn_banned_word_regex_guard', 'CREATE TRIGGER trg_banned_words_regex BEFORE INSERT OR UPDATE ON public.banned_words')), '')
ok('① D106 — REGEX 맞춤은 fn_regex_hit · EXACT · CONTAINS 그대로', "WHEN 'REGEX'    THEN fn_regex_hit(p_text, b.word)" in M and "WHEN 'CONTAINS' THEN position(lower(b.word) in lower(p_text)) > 0" in M
   and "WHEN 'EXACT'    THEN p_text = b.word" in M, '')
ok('① D106 — BANNED_REGEX 로 막음(DbErrorFilter 접두어 규칙 → 422)', "RAISE EXCEPTION 'BANNED_REGEX: " in M and re.search(r"\^\(\[A-Z\]\[A-Z0-9_-\]\{1,39\}\):", rd('src/common/db-error.filter.ts')), '')
body = re.sub(r'--[^\n]*', '', M)
ok('① D106 — 재실행 안전 · 자료를 지우지 않음(끄기만)', 'DROP TRIGGER IF EXISTS trg_banned_words_regex' in body and body.count('CREATE OR REPLACE FUNCTION') == 4
   and not re.search(r'\bDELETE\b|\bDROP TABLE\b|\bTRUNCATE\b', body) and 'SET is_active = false' in body, '')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마지막 마이그레이션 D106 · 144개(v10.70 부터 D107 · 145 — test_v1070)', (mig[-1], len(mig)) in (('D106_banned_regex_guard', 144), ('D107_review_identity_basis', 145), ('D108_review_rules_cleanup', 146), ('D109_audit_burst_actor', 147)), f'{mig[-1]} · {len(mig)}')
D = rd('src/modules/site/site.dto.ts')
blk = D[D.find('export class CreateBannedWordDto'):]; blk = blk[:blk.find('\n}')]
ok('② API — 맞춤 방식 · 수위는 정해진 값만', "@IsIn(['EXACT', 'CONTAINS', 'REGEX']) matchType" in blk and "@IsIn(['BLOCK', 'WARN']) severity" in blk
   and 'IsIn,' in D.split('\n', 2)[1], '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    L = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY id LIMIT 1")[1]
    rc, out, err = psql("BEGIN; INSERT INTO banned_words(word, match_type, severity) VALUES ('(시험', 'REGEX', 'BLOCK'); ROLLBACK;")
    ok('③ 잘못된 REGEX 넣기 → BANNED_REGEX 로 막힘', rc != 0 and 'BANNED_REGEX:' in err, err[:120])
    rc, out, err = psql("BEGIN; INSERT INTO banned_words(word, match_type, severity, is_active) VALUES ('(시험', 'REGEX', 'BLOCK', false) RETURNING is_active; ROLLBACK;")
    ok('③ 꺼진 채로는 넣을 수 있음(기록용)', rc == 0 and out.startswith('f'), err[:120])
    rc, out, err = psql("BEGIN; INSERT INTO banned_words(word, match_type, severity, is_active) VALUES ('(시험', 'REGEX', 'BLOCK', false); "
                        "UPDATE banned_words SET is_active = true WHERE word = '(시험'; ROLLBACK;")
    ok('③ 잘못된 줄 다시 켜기 → 막힘', rc != 0 and 'BANNED_REGEX:' in err, err[:120])
    rc, out, err = psql("BEGIN; SET LOCAL session_replication_role = replica; "
                        "INSERT INTO banned_words(word, match_type, severity) VALUES ('(시험1', 'REGEX', 'BLOCK'), ('[시험2', 'REGEX', 'WARN'); "
                        "SET LOCAL session_replication_role = origin; "
                        f"UPDATE listings SET title = title || ' 시험' WHERE id = '{L}'; "
                        "INSERT INTO review_items(target_type, target_id, gwan_code, submitted_by, sla_due_at) "
                        f"SELECT 'LISTING', id, gwan_code, owner_account_id, now() + interval '1 day' FROM listings WHERE id = '{L}'; "
                        f"SELECT decision_mode FROM review_items WHERE target_id = '{L}' ORDER BY submitted_at DESC LIMIT 1; ROLLBACK;")
    ok('③ 트리거를 거치지 않은 잘못된 줄이 있어도 매물 수정 · 검수 넣기가 멈추지 않음', rc == 0 and out in ('AUTO', 'MANUAL'), (out or err)[:120])
    rc, out, err = psql("BEGIN; INSERT INTO banned_words(word, match_type, severity) VALUES ('시험[0-9]{3}보장', 'REGEX', 'BLOCK'); "
                        f"UPDATE listings SET body = '시험123보장 상품' WHERE id = '{L}'; ROLLBACK;")
    ok('③ 맞는 REGEX 는 그대로 걸림(차단)', rc != 0 and 'BANNED_WORD:' in err, err[:120])
    rc, out, err = psql("SELECT count(*) FROM banned_words WHERE is_active AND match_type = 'REGEX' AND NOT fn_is_valid_regex(word)")
    ok('③ 켜진 잘못된 REGEX 줄 0', rc == 0 and out == '0', out or err)
else:
    print('     (DB 없음 — ③ 건너뜀 · DB=postgresql://sgb:sgb@localhost:15432/sgb 로 점검판에서)')
ok('VERSION v10.69 이상', re.match(r'v10\.(69|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
