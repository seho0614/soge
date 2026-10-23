"""v10.51 시험 — SUPER 는 모든 권한(2026-10-21 결정) · docs/104

  KIT=… python3 -I test_v1051.py

  ① 서버 — AuthGuard 가 hasRole(SUPER 항상 통과) · 게이트는 그대로 · 감사 actorRole SUPER · 코드 안 역할 검사도 hasRole
  ② 전수 — 모든 컨트롤러의 @Roles 를 hasRole 규칙으로 풀어 보면 SUPER 가 막히는 API 가 0
  ③ DB — D104 fn_has_role · 명세서 집행이 fn_has_role · 2인 원칙 문구 그대로 · 다른 마이그레이션은 안 바뀜
  ④ 화면 — SUPER 모든 탭 · 지급 · 입금 · 집행 단추
  ⑤ 기록 — 권한 매트릭스 SUPER 218 · VERSION · docs/104 · invariants SUP-1~4
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ① 서버
AU = rd('src/core/auth.ts')
ok('hasRole — SUPER 면 참', re.search(r"export const hasRole = [\s\S]{0,200}isSuper\(roles\) \|\|", AU) is not None, '')
ok('isSuper 는 SUPER 를 봄', "export const isSuper = (roles: readonly string[] | undefined | null): boolean => !!roles?.includes('SUPER');" in AU, '')
ok('AuthGuard 가 hasRole 사용', 'if (!hasRole(principal.roles, ...required)) {' in AU and 'required.some((r) => principal.roles.includes(r))' not in AU, '')
g = AU[AU.find('for (const gate of gates)'):AU.find('const c = RequestCtx.get();')]
ok('게이트(본인인증 · 구독)는 SUPER 도 그대로', 'IDENTITY_REQUIRED' in g and 'SUBSCRIPTION_REQUIRED' in g and 'isSuper' not in g and 'hasRole' not in g, '')
ok('감사 actorRole — SUPER 우선', "c.actorRole = isSuper(principal.roles) ? 'SUPER' : principal.roles[0];" in AU, '')
PS = rd('src/modules/identity/principal.service.ts')
ok('운영 역할 순서 고정(SUPER 맨 앞)', "(['SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT'] as Role[]).filter((r) => roles.includes(r))" in PS, '')
FS = rd('src/modules/file/file.service.ts')
ok('파일 업로드 검사도 hasRole', "import { hasRole } from '../../core/auth';" in FS and '!hasRole(p.roles, ...uploaders)' in FS, '')
AI = rd('src/core/audit.interceptor.ts')
ok('감사 기록 인터셉터는 역할로 거르지 않음(SUPER 도 기록)', 'INSERT INTO audit.audit_logs' in AI and 'SUPER' not in AI, '')

# ② 전수 — @Roles 를 풀어 SUPER 가 막히는 곳
blocked, total = [], 0
for f in sorted(glob.glob(os.path.join(K, 'src/modules/**/*.controller.ts'), recursive=True)):
    s = open(f, encoding='utf-8').read()
    for m in re.finditer(r"@Roles\(([^)]*)\)", s):
        total += 1
        if not re.search(r"'\w+'|\.\.\.\w+", m.group(1)):
            blocked.append(f'{os.path.basename(f)}:{m.group(1)}')
ok('컨트롤러 @Roles 전수 — 모두 hasRole 을 거침(SUPER 통과)', total > 250 and not blocked, f'{total}개 · {blocked[:3]}')
guards = [os.path.relpath(f, K) for f, s in {f: open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(K, 'src/**/*.ts'), recursive=True)}.items()
          if 'implements CanActivate' in s and 'ROLES_KEY' in s]
ok('역할로 막는 가드는 AuthGuard 하나(다른 길 없음)', guards == ['src/core/auth.ts'], str(guards))
code = {f: open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(K, 'src/**/*.ts'), recursive=True)}
direct = [os.path.relpath(f, K) for f, s in code.items()
          if re.search(r"roles\.includes\('(PAYOUT|REVIEWER)'\)", s)]
ok('서버 코드에 PAYOUT · REVIEWER 직접 비교 없음', not direct, str(direct))

# ③ DB
MIG = os.path.join(K, 'prisma/migrations')
D104 = rd('prisma/migrations/D104_super_all_permissions/migration.sql')
ok('D104 fn_has_role — SUPER 는 언제나 참', "CREATE OR REPLACE FUNCTION fn_has_role(p_account uuid, VARIADIC p_roles text[]) RETURNS boolean" in D104 and "(r.role = 'SUPER' OR r.role = ANY (p_roles))" in D104, '')
ok('명세서 집행 · 승인이 fn_has_role', "IF NOT fn_has_role(NEW.paid_by, 'PAYOUT') THEN" in D104 and "IF NOT fn_has_role(NEW.approved_by, 'ADMIN') THEN" in D104, '')
ok('명세서 2인 원칙 · 게이트 · 원장 그대로', all(t in D104 for t in ('자기가 신청한 것을 자기가 승인할 수 없습니다(2인 원칙)', '승인 · 신청한 사람은 집행할 수 없습니다(2인 원칙)', 'ADX_GATE', 'ADX_LEDGER')), '')
ok('D104 는 자료를 지우지 않음', not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D104), '')
_mig = sorted(d for d in os.listdir(MIG) if os.path.isdir(os.path.join(MIG, d)))
ok('D104 가 마지막 마이그레이션 · 142개(v10.65 부터 D105 · 143 — test_v1065 · v10.69 부터 D106 · 144 — test_v1069)', (_mig[-1], len(_mig)) in (('D104_super_all_permissions', 142), ('D105_switch_format', 143), ('D106_banned_regex_guard', 144), ('D107_review_identity_basis', 145), ('D108_review_rules_cleanup', 146), ('D109_audit_burst_actor', 147), ('D110_comment_report', 148), ('D111_search_synonym_expand', 149)), f'{_mig[-1]} · {len(_mig)}')
ok('정산 2인 원칙(fn_payout_two_person)은 그대로', '확정한 사람이 지급할 수 없습니다 — 2인 원칙' in rd('prisma/migrations/C997_ops_decisions/migration.sql'), '')
VI = rd('scripts/verify-invariants.sh')
ok('invariants SUP-1 ~ SUP-4', all(f'"SUP-{i} ' in VI for i in range(1, 5)), '')

# ④ 화면
APP = rd('web/src/App.tsx')
ok('SUPER 는 모든 탭', "roles.includes('SUPER') || (TAB_ROLES[t] ?? ['ADMIN']).some((r) => roles.includes(r));" in APP, '')
PY = rd('web/src/app/admin/Payouts.tsx')
ok('지급 화면 — SUPER 는 지급 · 입금 · 확정 단추', "const isPayout = isSuper || roles.includes('PAYOUT');" in PY and "const canConfirm = isSuper || roles.includes('ADMIN');" in PY, '')
AX = rd('web/src/app/admin/Adx.tsx')
ok('퍼블리셔 명세서 — SUPER 는 집행 단추', "isPay = roles.includes('PAYOUT') || roles.includes('SUPER')" in AX, '')

# ⑤ 기록
PM = rd('docs/02_권한매트릭스.md')
n = len(re.findall(r'^\| `SB-', PM, re.M))
sup = [l for l in PM.splitlines() if l.startswith('| `SB-') and l.split('|')[8].strip() != '●']
ok('권한 매트릭스 — SUPER 는 모든 화면', n > 200 and not sup and f'| SUPER | {n} |' in PM, f'{n} · 빈칸 {len(sup)}')
GD = rd('scripts/gen-docs.js')
ok("gen-docs can() — role === 'SUPER' 이면 참", "role === 'SUPER' || screen.roles.includes(role)" in GD, '')
ok('VERSION v10.51 이상', re.match(r'v10\.(5[1-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/104_SUPER_모든권한_v10.51_20261021.md')
ok('작업 문서 docs/104', all(h in doc for h in ('## 1. 결론', '## 2. 고치기 전', '## 4. 지키는 규칙', '## 6. 집 PC 확인', '## 7. 운영 적용')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
raise SystemExit(0 if n_ok == len(RES) else 1)
