"""v10.70 시험 — 자동검수 점검 ② 개인 회원 기준(D107 · docs/126)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1070.py

  ① D107 — 판정 함수에서 「인증 전」만 바뀜(본인인증 기준) · 나머지 판정은 B075 와 글자 그대로 · 이름표 · 정책 설명 · 재실행 안전 · 145개
  ② 생성 파일 codes.ts 의 이름표가 DB 이름표와 같음
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림
     · 사업자 인증 없음 + 본인인증 있음 → UNVERIFIED_BUSINESS 없음
     · 사업자 인증 없음 + 본인인증 없음 → UNVERIFIED_BUSINESS 있음
     · 사업자 인증 있음 → 없음(전과 같음) · 이름표 · 정책 설명
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


M = rd('prisma/migrations/D107_review_identity_basis/migration.sql')
B = rd('prisma/migrations/B075_functions/migration.sql')
b0 = B[B.find('CREATE FUNCTION public.fn_auto_review_reasons'):]; b0 = b0[:b0.find('END $$;') + 7]
m0 = M[M.find('CREATE OR REPLACE FUNCTION public.fn_auto_review_reasons'):]; m0 = m0[:m0.find('END $$;') + 7]
cut = lambda s: re.sub(r"  (?:-- D107[^\n]*\n  --[^\n]*\n  )?SELECT \* INTO pol FROM auto_review_policies WHERE key = 'manual_unverified_business';.*?END IF;\n", '', s, flags=re.S)
ok('① 판정 함수 — 「인증 전」 판정만 바뀌고 나머지는 B075 와 글자 그대로', m0 and cut(m0).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 1) == cut(b0), '')
ok('① 「인증 전」 = 사업자 인증 없음 그리고 본인인증 없음', 'AND NOT EXISTS (SELECT 1 FROM accounts a' in m0 and 'a.identity_verified_at IS NOT NULL' in m0
   and "reasons := array_append(reasons, 'UNVERIFIED_BUSINESS');" in m0, '')
ok('① 이름표 · 정책 설명 · 재실행 안전 · 자료를 지우지 않음', "SET label = '본인 · 사업자 인증 전'" in M and "WHERE key = 'manual_unverified_business'" in M
   and M.count('IS DISTINCT FROM') == 2 and not re.search(r'\bDELETE\b|\bDROP\b|\bTRUNCATE\b', re.sub(r'--[^\n]*', '', M)), '')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마지막 마이그레이션 D107 · 145개(v10.71 부터 D108 · 146 — test_v1071)', (mig[-1], len(mig)) in (('D107_review_identity_basis', 145), ('D108_review_rules_cleanup', 146), ('D109_audit_burst_actor', 147), ('D110_comment_report', 148), ('D111_search_synonym_expand', 149), ('D112_search_synonym_seed', 150), ('D113_job_stale_weekly', 151), ('D114_seed_ad_ends_extend', 152), ('D115_i18n_base', 153)), f'{mig[-1]} · {len(mig)}')
ok('② codes.ts 이름표 = DB 이름표', '    UNVERIFIED_BUSINESS: { label: "본인 · 사업자 인증 전", tone: \'warning\', audience: \'ADMIN\' },' in rd('src/generated/codes.ts'), '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    L = psql("SELECT l.id FROM listings l WHERE l.status = 'PUBLISHED' ORDER BY l.id LIMIT 1")[1]
    def case(biz, ident):
        sets = 'SET LOCAL session_replication_role = replica; '
        if not biz: sets += f"UPDATE businesses SET verified_at = NULL WHERE account_id = (SELECT owner_account_id FROM listings WHERE id = '{L}'); "
        sets += f"UPDATE accounts SET identity_verified_at = {'now()' if ident else 'NULL'} WHERE id = (SELECT owner_account_id FROM listings WHERE id = '{L}'); "
        sets += 'SET LOCAL session_replication_role = origin; '
        return psql(f"BEGIN; {sets} INSERT INTO review_items(target_type, target_id, gwan_code, submitted_by, sla_due_at) "
                    f"SELECT 'LISTING', id, gwan_code, owner_account_id, now() + interval '1 day' FROM listings WHERE id = '{L}'; "
                    f"SELECT coalesce(array_to_string(manual_reasons, ','), '') FROM review_items WHERE target_id = '{L}' ORDER BY submitted_at DESC LIMIT 1; ROLLBACK;")
    rc, out, err = case(False, True)
    ok('③ 사업자 인증 없음 + 본인인증 → 「인증 전」 없음', rc == 0 and 'UNVERIFIED_BUSINESS' not in out, (out or err)[:120])
    rc, out, err = case(False, False)
    ok('③ 사업자 인증 없음 + 본인인증 없음 → 「인증 전」', rc == 0 and 'UNVERIFIED_BUSINESS' in out, (out or err)[:120])
    rc, out, err = case(True, False)
    ok('③ 사업자 인증 있음 → 「인증 전」 없음(전과 같음)', rc == 0 and 'UNVERIFIED_BUSINESS' not in out, (out or err)[:120])
    rc, out, err = psql("SELECT label FROM code_labels WHERE domain = 'review.manual_reason' AND code = 'UNVERIFIED_BUSINESS'")
    rc2, out2, _ = psql("SELECT description FROM auto_review_policies WHERE key = 'manual_unverified_business'")
    ok('③ 이름표 · 정책 설명', out == '본인 · 사업자 인증 전' and '본인인증' in out2, f'{out} · {out2}')
else:
    print('     (DB 없음 — ③ 건너뜀 · DB=postgresql://sgb:sgb@localhost:15432/sgb 로 점검판에서)')
ok('VERSION v10.70 이상', re.match(r'v10\.([7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
