"""v10.134 시험 — 영어 문장 점검 2묶음 · 복수형 · 기능 점검 거래 흐름 기다림(docs/201)

  KIT=<kit> python3 -I test_v1134.py   (파일만 봄 · 점검판 불필요)

  ① 2묶음 30건(en_review_b2_v1134.json)이 사전에 들어감 · 옛 글은 없음 · 자리({n} · <b>)가 그대로
  ② 복수형 17곳 — 「{n} 낱말s」 대신 ICU 복수형 · 한국어 사전은 그대로
  ③ flow_trade — 사업자 인증 신청은 서버 응답을 먼저 기다림(60초)
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
M = os.path.join(K, 'site/src/i18n/messages')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def get(d, k):
    for p in k.split('.'):
        d = d[p]
    return d


def en(ns):
    return json.load(open(os.path.join(M, f'en/{ns}.json'), encoding='utf-8'))


R = json.load(open(os.path.join(HERE, 'en_review_b2_v1134.json'), encoding='utf-8'))
miss = [r['key'] for r in R if get(en(r['ns']), r['key']) != r['proposed']]
ok('① 2묶음 30건이 사전에 들어감', len(R) == 30 and not miss, f'{len(R)} · 빠짐 {miss[:3]}')
ph = [r['key'] for r in R if sorted(re.findall(r'\{\w+\}|<\w+>', r['en'])) != sorted(re.findall(r'\{\w+\}|<\w+>', r['proposed']))]
ok('① 고친 글의 자리({n} · <b> …)가 옛 글과 같음', not ph, str(ph))
ok('① 소개몰 이름 「Sogae Mall」로 통일(사용자 웹 사전에 SogaeMall 없음)', not any('SogaeMall' in open(os.path.join(M, 'en', f), encoding='utf-8').read() for f in os.listdir(os.path.join(M, 'en'))), '')

PL = {'affiliate': ['layout.unreadAria'], 'consult': ['detail.step3B', 'rows.certified'], 'deal': ['invite.valid'],
      'forms': ['common.missing', 'reg.filled', 'req.filled'], 'gwan': ['biz.headcount'], 'plaza': ['event.people', 'food.recCount', 'food.recs'],
      'policy': ['agree.pendingN'], 'refcode': ['share.freeN'], 'join': ['give.newListings'],
      'my': ['home.settle.open', 'home.settle.none', 'sub.codesN', 'sub.extraRow', 'pay.extraRow']}
notpl = [f'{ns}.{k}' for ns, ks in PL.items() for k in ks if '{n, plural, one {' not in get(en(ns), k)]
ok('② 복수형 — 개수 문장이 ICU 복수형(1 person · 1 valid connection …)', sum(len(v) for v in PL.values()) >= 17 and not notpl, str(notpl))
ko = [f'{ns}.{k}' for ns, ks in PL.items() for k in ks
      if 'plural' in json.dumps(get(json.load(open(os.path.join(M, f'ko/{ns}.json'), encoding='utf-8')), k), ensure_ascii=False)]
ok('② 한국어 사전은 그대로(복수형 없음)', not ko, str(ko))

F = open(os.path.join(HERE, 'flow_trade.py'), encoding='utf-8').read()
ok('③ flow_trade — 사업자 인증 신청 응답을 먼저 기다리고(60초) 안내는 60초까지 · 기록에 서버 응답',
   "expect_response(lambda r: '/api/v1/businesses' in r.url" in F and "'main form.auth .form-error')), 60)" in F and '서버 응답 {resp[0]}' in F, '')
V = open(os.path.join(K, 'VERSION'), encoding='utf-8').read().strip()
ok('판 v10.134 이상', tuple(int(x) for x in re.findall(r'\d+', V)) >= (10, 134), V)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
