"""v10.133 시험 — 처리방침 · 위탁 안내 · 맞춤형 광고 약관 새 판 초안(D131 · docs/199)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1133.py

  ① 글(terms-text.js) — 처리방침(AI 상담 5년 · Anthropic 위탁 · 제6조 국외 이전 · 〔확인 필요〕) · 위탁 안내(Anthropic 줄 · 제3조 ③) · 맞춤형 광고(설문 답 + 동의 뒤 클릭 · 철회하면 지움)
     · docs/terms 3개가 같은 글 · D131 이 terms-text.js 와 같은 글 · 게시하지 않음 · 지우는 문장 없음 · 169 · SV-T5 는 초안이 있으면 초안만 견줌
  ② (DB · API) 초안(DRAFT · LEGAL_REVIEW)이 새 글 · 게시된 판은 그대로 · 손님 화면은 게시된 판(새 글 안 나감) · 다시 돌려도 바뀌지 않음
"""
import json, os, re, subprocess, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


T = rd('scripts/terms-text.js')
def term(code):
    m = re.search(rf"\n  {code}: `((?:\\.|[^`\\])*)`", T, re.S)   # \` 는 글 안의 백틱
    return m.group(1).replace('\\`', '`').replace('\\\\', '\\') if m else ''


P, O, A = term('PRIVACY'), term('OUTSOURCE'), term('ADPERSONAL')
ok('① 처리방침 — AI 상담 대화 5년 · Anthropic 위탁 · 제6조 국외 이전(가림 · 확인 필요 칸) · 옛 「국외로 보내지 않습니다」 없음',
   '| AI 상담 대화 | **5년** |' in P and '| Anthropic, PBC(미국) | AI 상담 답변' in P and '개인정보 보호법 제28조의8' in P
   and '〔확인 필요 — Anthropic API 의 데이터 보관 정책〕' in P and '국외로 보내지\n않습니다' not in P, '')
ok('① 위탁 안내 — Anthropic 줄 · 제3조 ③ 「AI 기능을 쓸 때에는 위 업체(미국)로 전송」', '| Anthropic, PBC(미국) | AI 답변 · 번역 · 검수 의견 |' in O and 'AI 기능을 쓸 때에는 위' in O and '국외로 보내지 않습니다' not in O, '')
ok('① 맞춤형 광고 — 설문 답 + 동의 뒤 광고 클릭 · 동의 전 기록 안 씀 · 철회하면 바로 지움 · 옛 「서비스 이용 기록」 없음',
   '관심 성향 설문에 답한 내용' in A and '뒤에 광고를\n누른 기록' in A and '동의하시기 전의 기록' in A and '바로 지우고' in A and '서비스 이용 기록' not in A, '')
for c, body in (('PRIVACY', P), ('OUTSOURCE', O), ('ADPERSONAL', A)):
    d = rd(f'docs/terms/{c}.md')
    ok(f'① docs/terms/{c}.md = terms-text.js(SV-T5 기준 글)', d.strip() == body.strip() or body.strip() in d, f'{len(d)} / {len(body)}')
M = rd('prisma/migrations/D131_terms_ai_adpersonal_drafts/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D131 — 세 글이 terms-text.js 와 같음 · 게시 안 함(PUBLISHED 로 바꾸는 문장 없음) · 지우는 문장 없음 · 169',
   all(f"$TERM${b}$TERM$" in M for b in (P, O, A)) and "SET status = 'PUBLISHED'" not in M and "'LEGAL_REVIEW'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and (len(mig), mig[-1]) == (169, 'D131_terms_ai_adpersonal_drafts'), f'{len(mig)} · {mig[-1]}')
INV = rd('scripts/verify-invariants.sh')
ok('① 불변식 SV-T5 — 새 판 초안이 있는 코드는 게시된 옛 판을 견주지 않음', "NOT (status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM terms d WHERE d.code = t.code AND d.status IN ('DRAFT','LEGAL_REVIEW')))" in INV, '')
ok('① 판 v10.133 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 133), rd('VERSION').strip())


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def get(p):
    return json.load(urllib.request.urlopen(API + p, timeout=60))


if API and DB:
    for c, key in (('PRIVACY', 'Anthropic'), ('OUTSOURCE', 'Anthropic'), ('ADPERSONAL', '관심 성향 설문에 답한 내용')):
        drafts = psql(f"SELECT version || ':' || (position($k${key}$k$ in body) > 0)::text FROM terms WHERE code = '{c}' AND status IN ('DRAFT','LEGAL_REVIEW')")
        pub = psql(f"SELECT version || ':' || (position($k${key}$k$ in body) > 0)::text FROM terms WHERE code = '{c}' AND status = 'PUBLISHED'")
        # 운영처럼 옛 글이 게시된 DB 에서는 「게시 = 옛 글 · 초안 = 새 글」. 빈 DB 로 새로 세운 점검판(개발 DB)은 게시된 1.0 이 처음부터 새 글일 수 있음(10/28 회귀).
        #   그래서 지킬 것만 봄 — 초안이 있으면 새 글 · 새 글이 어딘가(초안 또는 게시)에 있음 · 손님 화면은 게시된 판(초안이 아님)
        ok(f'② {c} — 초안이 있으면 새 글 · 새 글이 초안 또는 게시된 판에 있음', (drafts == '' or drafts.endswith(':true')) and (drafts.endswith(':true') or pub.endswith(':true')), f'초안 {drafts} · 게시 {pub}')
        doc = get(f'/terms/doc/{c}')
        ok(f'② {c} — 손님 화면(공개 약관)은 게시된 판(초안이 아님)', not pub or str(doc.get('version')) == pub.split(':')[0], f"{doc.get('version')} · 게시 {pub}")
    before = psql("SELECT string_agg(code || version || md5(body), ',' ORDER BY code, version) FROM terms WHERE code IN ('PRIVACY','OUTSOURCE','ADPERSONAL')")
    # 다시 돌림(재실행 안전) — 마이그레이션의 DO 블록만 그대로 실행
    body = M.split('-- =====================================================================\n', 2)[-1]
    r = subprocess.run(['psql', DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], input=body, capture_output=True, text=True)
    after = psql("SELECT string_agg(code || version || md5(body), ',' ORDER BY code, version) FROM terms WHERE code IN ('PRIVACY','OUTSOURCE','ADPERSONAL')")
    ok('② 다시 돌려도 판 · 글이 늘거나 바뀌지 않음', r.returncode == 0 and before == after, r.stderr.strip()[:80])

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
