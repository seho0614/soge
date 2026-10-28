"""v10.118 시험 — 관심 성향 문항 · 보기 · 세그먼트 이름을 번역 대상으로(D124 · docs/182)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1118.py

  ① D124 — 대상 셋(PROFILE_Q · PROFILE_OPT · AD_SEGMENT) · 원문 함수 · 나머지 그대로 · 162 · 마지막 D124
  ② 코드 — 받는 대상 · 원문 목록 · 운영 화면 대상 · 성향 응답에 번역 얹기
  ③ (API · DB) 원문 목록 · 번역 넣기 · 승인 → 영어(X-Lang en · 다국어 켬)면 문항 · 보기 · 세그먼트가 영어 · 한국어는 그대로 — 끝나면 되돌림
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D124_i18n_profile/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 162 · 마지막 D124(v10.119 부터 D125 · 163 — test_v1119)', (len(mig), mig[-1] if mig else '') in ((162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 대상 셋 · 원문(문항 · 「문항:보기」 · 세그먼트 이름 · 설명) · 이전 대상 그대로',
   "'PROFILE_Q','PROFILE_OPT','AD_SEGMENT'" in M and "WHEN 'PROFILE_Q' THEN IF p_field = 'question'" in M and "split_part(p_id, ':', 2)" in M
   and "WHEN 'AD_SEGMENT' THEN IF p_field IN ('name','description')" in M and "WHEN 'HLT_PRODUCT' THEN" in M and "WHEN 'CATEGORY' THEN" in M, '')
I = rd('src/modules/i18n/i18n.service.ts'); A = rd('src/modules/ads/ads.service.ts'); T = rd('web/src/app/admin/Translations.tsx'); C = rd('src/modules/i18n/i18n.controller.ts')
ok('② 받는 대상 · 원문 목록(서버 · 컨트롤러 · 운영 화면)',
   "PROFILE_Q: ['question'], PROFILE_OPT: ['label'], AD_SEGMENT: ['name', 'description']" in I and "PROFILE_OPT: { from: 'profile_options s'" in I
   and "'PROFILE_Q', 'PROFILE_OPT', 'AD_SEGMENT'" in C and "PROFILE_Q: '관심 성향 문항'" in T and "label: '보기'" in T, '')
ok('② 성향 응답에 번역 얹기 — 문항 · 보기 · 세그먼트(진단 · 내 성향)',
   "this.i18n.overlay(qs, 'PROFILE_Q'" in A and "overlayBy(opts, 'PROFILE_OPT', '_id'" in A and A.count("'AD_SEGMENT'") >= 4, '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if API and DB:
    TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    TS = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    SEG = psql('SELECT code FROM ad_segments ORDER BY sort_order LIMIT 1')
    made = []
    try:
        cat = {t: call('GET', f'/admin/i18n/catalog?targetType={t}&lang=en&size=100', t=TA) for t in ('PROFILE_Q', 'PROFILE_OPT', 'AD_SEGMENT')}
        ids = {t: [x['targetId'] for x in (c.get('items') or [])] for t, c in cat.items()}
        ok('③ 원문 목록 — 문항 6 · 보기 「q1:re」 · 세그먼트', len(ids['PROFILE_Q']) >= 6 and 'q1:re' in ids['PROFILE_OPT'] and SEG in ids['AD_SEGMENT'],
           f"{len(ids['PROFILE_Q'])} · {len(ids['PROFILE_OPT'])} · {len(ids['AD_SEGMENT'])}")
        for t, tid, f, txt in (('PROFILE_Q', 'q1', 'question', 'Which fields do you mainly work in?'), ('PROFILE_OPT', 'q1:re', 'label', 'Real estate · shops'),
                               ('AD_SEGMENT', SEG, 'name', 'TEST1118 segment')):
            u = call('PUT', '/admin/i18n/translations', {'targetType': t, 'targetId': tid, 'field': f, 'lang': 'en', 'text': txt}, TA)
            if u.get('id'):
                made.append(u['id']); call('POST', f"/admin/i18n/translations/{u['id']}/approve", t=TA)
        ok('③ 번역 넣기 · 승인 3건', len(made) == 3 and psql(f"SELECT count(*) FROM content_translations WHERE id = ANY('{{{','.join(made)}}}'::bigint[]) AND status = 'APPROVED'") == '3', str(made))
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)   # overlay 설정 기억(30초)
        en = call('GET', '/profile/questions', t=TS, h={'X-Lang': 'en'}); ko = call('GET', '/profile/questions', t=TS)
        q1e = next((q for q in en.get('questions', []) if q['code'] == 'q1'), {}); q1k = next((q for q in ko.get('questions', []) if q['code'] == 'q1'), {})
        oe = next((o for o in q1e.get('options', []) if o['code'] == 're'), {})
        ok('③ 영어 — 문항 · 보기가 번역 · 숨긴 번호 칸(_id) 없음', q1e.get('question') == 'Which fields do you mainly work in?' and oe.get('label') == 'Real estate · shops' and '_id' not in oe, f"{q1e.get('question')} · {oe}")
        ok('③ 한국어 — 그대로', q1k.get('question') == '어떤 분야를 주로 다루십니까?', q1k.get('question'))
        an = call('POST', '/profile/analyze', {'answers': {'q1': ['re']}}, TS, h={'X-Lang': 'en'})
        ok('③ 영어 진단 — 세그먼트 이름 · 근거 막대 이름이 번역', an.get('code') == SEG and an.get('name') == 'TEST1118 segment'
           and any(x.get('name') == 'TEST1118 segment' for x in an.get('ranking', [])), f"{an.get('code')} · {an.get('name')}")
    finally:
        if made: psql(f"DELETE FROM content_translations WHERE id = ANY('{{{','.join(made)}}}'::bigint[]);")
        en0, act0 = before.split(',')
        psql(f"UPDATE site_settings SET value='{en0}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
