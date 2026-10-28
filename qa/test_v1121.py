"""v10.121 시험 — 쓰지 않는 사용자 웹 부품 8개 지우기(docs/185)

  docker run --rm -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core sgb-qa:v1 python3 test_v1121.py

  ① 지운 파일 8개가 없음 · 사용자 웹 어디에서도 그 이름을 불러 쓰지 않음(주석 밖)
  ② copy.ts — AXIS · SAFE_LISTING 지움 · SAFE_CONSULT · CSL_DESC 남음
  ③ 판 v10.121 · 마이그레이션 없음(163 · D125) · 옛 시험 목록에 지운 파일 없음
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
QA = os.path.dirname(os.path.abspath(__file__))
RES = []

GONE = ['components/mal/MalMain.tsx', 'components/Questions.tsx', 'components/AuthForm.tsx', 'components/listing/DetailBar.tsx',
        'components/ClassifyPanel.tsx', 'components/RegisterPicker.tsx', 'components/listing/CategoryArt.tsx', 'components/partners/PartnerNav.tsx']


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def strip_comments(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    return re.sub(r'(^|[^:\'"])//[^\n]*', r'\1', t)


S = os.path.join(K, 'site/src')
left = [f for f in GONE if os.path.exists(os.path.join(S, f))]
ok('① 지운 파일 8개가 없음', not left, ' · '.join(left))

src = {}
for root, _, files in os.walk(S):
    for x in files:
        if x.endswith(('.ts', '.tsx')):
            p = os.path.join(root, x); src[os.path.relpath(p, S)] = strip_comments(rd(p))
names = [os.path.basename(f)[:-4] for f in GONE]
hits = [f'{f}: {n}' for f, t in src.items() for n in names if re.search(rf'[/\'"]{n}[\'"]|<{n}[\s/>]|\b{n}\(', t)]
ok(f'① 사용자 웹 {len(src)}개 파일에서 지운 부품을 부르는 곳 없음', len(src) > 300 and not hits, ' | '.join(hits[:4]))

CP = rd(os.path.join(S, 'components/mal/copy.ts'))
ok('② copy.ts — AXIS · SAFE_LISTING 지움 · SAFE_CONSULT · CSL_DESC 남음',
   'export const AXIS' not in CP and 'export const SAFE_LISTING' not in CP
   and "export const SAFE_CONSULT = ['safe.s1', 'safe.s2', 'safe.s3'] as const" in CP and 'export const CSL_DESC' in CP, '')
use = [f for f, t in src.items() if re.search(r'\b(AXIS|SAFE_LISTING)\b', t) and 'mal/copy' in t]
ok('② AXIS · SAFE_LISTING 을 copy.ts 에서 가져오는 곳 없음', not use, ' · '.join(use))

_v = tuple(int(x) for x in re.findall(r'\d+', rd(os.path.join(K, 'VERSION'))))
ok('③ 판 v10.121 이상', _v >= (10, 121), rd(os.path.join(K, 'VERSION')).strip())
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('③ 마이그레이션 없음 — 163 · 마지막 D125', (len(mig), mig[-1] if mig else '') in ((163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist')), f'{len(mig)} · {mig[-1] if mig else ""}')
old = [f'{t}: {g}' for t in ('test_v1100.py', 'test_v1101.py') for g in GONE if f"'{g}'" in rd(os.path.join(QA, t))]
ok('③ 옛 시험(1100 · 1101) 목록에 지운 파일 없음', not old, ' · '.join(old))

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
