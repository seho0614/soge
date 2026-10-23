"""v10.65 시험 — 관리자 스위치(docs/121)

  KIT=… python3 -I test_v1065.py

  ① D105 — 기능 스위치(feature.referral_fee · feature.success_fee) 형식 검사 '^(on|off)$' · 대소문자만 다른 값 바로잡기 · 재실행 안전
  ② 서버 — 설정 변경이 형식 검사 뒤 스위치 조건(SWITCH_PREREQ)을 봄 · 5개 스위치 · 되돌리는 쪽은 조건 없음
  ③ 운영 화면 — 오픈 체크리스트에 관리자 스위치 카드 · 서버와 같은 5개 · 같은 방향 · 같은 연동 조건 · 확인 칸
  ④ 정적 검사 — 바뀐 .ts · .tsx 에서 쓰는 이름이 모두 import · 선언됨(서버에서 tsc 를 못 돌림)
  ⑤ precheck 가 기능 스위치 값을 보여 줌 · 마이그레이션 파일 143
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D105_switch_format/migration.sql')
ok('D105 — 기능 스위치 2개 형식 검사 · 값 바로잡기 · 재실행 안전',
   "SET value_pattern = '^(on|off)$', value_example = 'off'" in M and "('feature.referral_fee', 'feature.success_fee')" in M
   and 'IS DISTINCT FROM' in M and "SET value = lower(btrim(value))" in M and "AND value <> lower(btrim(value))" in M and 'DELETE' not in M.upper().replace('지우지', ''), '')

S = rd('src/modules/admin/admin.service.ts')
i_fmt, i_sw, i_up = S.find("throw new PolicyViolation('SETTING_FORMAT'"), S.find('await this.checkSwitch(key, value);'), S.find('UPDATE site_settings SET value = $2')
ok('서버 — 형식 검사 → 스위치 조건 → 저장 순서', 0 < i_fmt < i_sw < i_up, '')
rules = dict(re.findall(r"'((?:assume|feature)\.[\w.]+)': \{ to: '(on|off)'", S))
ok('서버 — 스위치 5개 · 실제로 돌리는 쪽만 조건', rules == {'assume.payment': 'off', 'assume.broker': 'off', 'assume.etax': 'off', 'assume.bank': 'off', 'feature.referral_fee': 'on'}
   and "if (!rule || (value ?? '').trim() !== rule.to) return;" in S and "PolicyViolation('SWITCH_PREREQ'" in S, str(rules))
sinteg = {k: v for k, v in re.findall(r"'((?:assume|feature)\.[\w.]+)': \{ to: '(?:on|off)', integ: \[([^\]]*)\]", S)}

W = rd('web/src/app/admin/Switches.tsx')
wsw = dict(re.findall(r"key: '((?:assume|feature)\.[\w.]+)', label: '[^']*', go: '(on|off)'", W))
winteg = {k: v for k, v in re.findall(r"key: '((?:assume|feature)\.[\w.]+)'[^}]*?integ: \[([^\]]*)\]", W, flags=re.S)}
ok('운영 화면 — 서버와 같은 5개 · 같은 방향 · 같은 연동 조건', wsw == rules and winteg == sinteg, f'{wsw} · {winteg}')
ok('운영 화면 — 확인 칸 · 감사 기록 API(PATCH /admin/site-settings) · 되돌리기 단추', 'data-switch-confirm' in W and "api('/admin/site-settings', { method: 'PATCH'" in W and 'backLabel' in W, '')
OC = rd('web/src/app/admin/OpenChecklist.tsx')
ok('오픈 체크리스트에 관리자 스위치 카드', "import { Switches } from './Switches';" in OC and '<Switches />' in OC, '')

GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN'}


def undefined_names(s):
    code = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    code = re.sub(r'>[^<>{}]*<', '><', code)      # JSX 안 글자
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'\b([A-Z][a-z][A-Za-z0-9_]*)\b', code))
    return sorted(used - imp - decl - GLOBALS)


for f in ('src/modules/admin/admin.service.ts', 'web/src/app/admin/Switches.tsx', 'web/src/app/admin/OpenChecklist.tsx'):
    miss = undefined_names(rd(f))
    ok(f'쓰는 이름이 모두 import · 선언됨 — {os.path.basename(f)}', not miss, ' · '.join(miss))

ok('precheck — 기능 스위치 값을 보여 줌', "where key like 'feature.%'" in rd('deploy/aws/precheck.sh'), '')
n = len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))])
ok('마이그레이션 파일 143(v10.69 부터 D106 · 144 — test_v1069)', n in (143, 144, 145, 146, 147, 148), str(n))
ok('VERSION v10.65 이상', re.match(r'v10\.(6[5-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
c = sum(1 for r in RES if r[0])
print(f'통과 {c} / {len(RES)}')
