"""v10.119 시험 — 영어 화면에 남은 한국어(D125 · docs/183)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1119.py

  ① D125 — 대상 여섯(FOOTER_LINK · SETTING · POLL · POLL_OPT · INGREDIENT · HLT_CONCERN) · 원문 함수 · 바닥줄 보기 id · 163 · 마지막 D125
  ② 코드 — 받는 대상 · 원문 목록 · 운영 화면 · 응답 얹기(바닥줄 · 법정 고지 · 투표 · 성분 · 고민 · 대표 성분 · 상담 업종)
     · 사전(safety · region · 목록 탭 제목 · 인기 성분 칩) — 한국어 · 영어 키가 같음
  ③ (API · DB) 번역 넣기 · 승인 → 영어(X-Lang en · 다국어 켬)면 번역 · 한국어는 그대로 · 숨긴 번호 칸 없음 — 끝나면 되돌림
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


def keys(d, pre=''):
    out = set()
    for k, v in d.items():
        out |= keys(v, pre + k + '.') if isinstance(v, dict) else {pre + k}
    return out


M = rd('prisma/migrations/D125_i18n_more_targets/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 163 · 마지막 D125', (len(mig), mig[-1] if mig else '') in ((163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks'), (185, 'D147_mail_lock'), (186, 'D148_alimtalk_etax_lock'), (187, 'D149_privacy_ai_ready')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 대상 여섯 · 원문(법정 고지 둘만) · 이전 대상 그대로 · 바닥줄 보기 끝에 id',
   "'FOOTER_LINK','SETTING','POLL','POLL_OPT','INGREDIENT','HLT_CONCERN'" in M and "p_id IN ('legal.intermediary_notice','legal.direct_notice')" in M
   and "WHEN 'PROFILE_OPT' THEN" in M and "WHEN 'HLT_PRODUCT' THEN" in M and "'CATEGORY','POLL','POLL_OPT') AND p_id !~*" in M
   and re.search(r"f\.blocked_by\) AS tip,\s+f\.id\s+FROM footer_links f", M) is not None, '')
I = rd('src/modules/i18n/i18n.service.ts'); C = rd('src/modules/i18n/i18n.controller.ts'); T = rd('web/src/app/admin/Translations.tsx')
ok('② 받는 대상 · 원문 목록(서버 · 컨트롤러 · 운영 화면)',
   "FOOTER_LINK: ['label'], SETTING: ['value'], POLL: ['title', 'description'], POLL_OPT: ['label', 'sub']" in I and "INGREDIENT: ['name'], HLT_CONCERN: ['name']" in I
   and "SETTING: { from: `(SELECT key, value FROM site_settings WHERE key IN" in I and "'FOOTER_LINK', 'SETTING', 'POLL', 'POLL_OPT', 'INGREDIENT', 'HLT_CONCERN'" in C
   and "SETTING: '법정 고지'" in T and "value: '문장', sub: '보조 글'" in T, '')
S = {n: rd(p) for n, p in (('cat', 'src/modules/catalog/catalog.service.ts'), ('pub', 'src/modules/public/public.service.ts'), ('poll', 'src/modules/community/poll.service.ts'),
                            ('hc', 'src/modules/health/health-catalog.service.ts'), ('hr', 'src/modules/health/health-review.service.ts'), ('cs', 'src/modules/partner/consult.service.ts'))}
ok('② 응답 얹기 — 바닥줄 · 법정 고지 · 투표(손님만) · 성분 · 고민 · 대표 성분 · 상담 업종(목록 · 상세)',
   "overlayBy(rows, 'FOOTER_LINK', '_id'" in S['cat'] and "'SETTING', (r) => r.key" in S['pub'] and "I18N_SETTING_KEYS.includes" in S['pub']
   and S['poll'].count('this.translated(') == 2 and "'POLL_OPT'" in S['poll'] and S['hc'].count("'INGREDIENT'") >= 3 and S['hc'].count("'HLT_CONCERN'") >= 3
   and S['hc'].count('overlayMainIngredient(') >= 3 and 'overlayMainIngredient(' in S['hr'] and S['cs'].count("'CATEGORY'") == 2, '')
MS = 'site/src/i18n/messages/'
sk, se = json.loads(rd(MS + 'ko/safety.json') or '{}'), json.loads(rd(MS + 'en/safety.json') or '{}')
bk, be = json.loads(rd(MS + 'ko.json') or '{}'), json.loads(rd(MS + 'en.json') or '{}')
SF = rd('site/src/lib/safety.ts')
ok('② 안전 수칙 사전 — 한국어 · 영어 키 같음(규칙 5 · 유형 5 · 장치 4 · 신고 3) · 코드에 한글 문장 없음',
   keys(sk) == keys(se) and len(sk.get('rules', {})) == 5 and len(sk.get('guides', {})) == 5 and len(sk.get('platform', {})) == 4 and len(sk.get('report', {})) == 3
   and not re.search(r"'[^'\n]*[가-힣][^'\n]*'", SF) and 'safety' in rd(MS + 'index.ts'), f'{len(keys(sk))} 키')
ok('② 시 · 도 사전 17 — 세 화면이 값은 한국어 · 글자는 사전',
   len([k for k in bk.get('region', {}) if k != 'all']) == 17 and keys(bk.get('region', {})) == keys(be.get('region', {})) and be['region'].get('seoul') == 'Seoul'
   and all("tr(c) : " in rd(p) and "sidoCode(" in rd(p) for p in ('site/src/app/consult/ConsultForm.tsx', 'site/src/components/partner/RegionEditor.tsx', 'site/src/app/partner/business/BizForms.tsx')), '')
ok('② 활동 지역 칩 · 업종 상세 지역도 사전 · 바닥줄 key 는 이름 대신 순서(번역 이름이 겹쳐도)',
   '{shown(r)} ✕' in rd('site/src/components/partner/RegionEditor.tsx') and '<b>{sido(r.sido)}</b>' in rd('site/src/app/mal/consult/[code]/page.tsx')
   and not any('key={l.label}' in rd(p) for p in ('site/src/components/Footer.tsx', 'site/src/components/b2/Frame.tsx', 'site/src/components/home/Frame.tsx')), '')
ok('② 목록 탭 제목 셋 · 인기 성분 칩(코드로 찾고 성분 이름을 보임)',
   all("t('list.title', { name: t('meta." in rd(f'site/src/app/{g}/list/page.tsx') for g in ('mall', 'biz', 'money'))
   and "['VITC', '비타민C']" in rd('site/src/app/health/search/page.tsx') and '{label}</Link>' in rd('site/src/app/health/search/page.tsx'), '')


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
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    POLL = psql("SELECT p.id FROM polls p JOIN v_poll_home h ON h.id = p.id ORDER BY p.kind LIMIT 1")
    OPT = psql(f"SELECT id FROM poll_options WHERE poll_id = '{POLL}' ORDER BY sort LIMIT 1") if POLL else ''
    CON = (call('GET', '/health/concerns') or [{}])[0].get('code', '')
    CAT = psql("SELECT id FROM categories WHERE gwan_code='MAL' AND axis='CONSULT' AND status='APPROVED' ORDER BY name LIMIT 1")
    CATC = psql(f"SELECT code FROM categories WHERE id = '{CAT}'")
    made = []
    try:
        cat = {t: call('GET', f'/admin/i18n/catalog?targetType={t}&lang=en&size=100', t=TA) for t in ('FOOTER_LINK', 'SETTING', 'POLL', 'POLL_OPT', 'INGREDIENT', 'HLT_CONCERN')}
        ids = {t: [x['targetId'] for x in (c.get('items') or [])] for t, c in cat.items()}
        ok('③ 원문 목록 — 바닥줄 · 법정 고지 둘(v10.132 부터 + 상호) · 투표 · 보기 · 성분(VITC) · 고민',
           '1' in ids['FOOTER_LINK'] and sorted(ids['SETTING']) in (['legal.direct_notice', 'legal.intermediary_notice'], ['footer.company_name', 'legal.direct_notice', 'legal.intermediary_notice'])   # v10.132 상호(D130) and POLL in ids['POLL']
           and OPT in ids['POLL_OPT'] and 'VITC' in ids['INGREDIENT'] and CON in ids['HLT_CONCERN'], json.dumps({k: len(v) for k, v in ids.items()}))
        bad = call('PUT', '/admin/i18n/translations', {'targetType': 'SETTING', 'targetId': 'site.name', 'field': 'value', 'lang': 'en', 'text': 'x'}, TA)
        ok('③ 법정 고지 밖의 설정 키는 번역 못 넣음', bad.get('_err') in (404, 409, 422), json.dumps(bad, ensure_ascii=False)[:120])
        W = (('FOOTER_LINK', '1', 'label', 'T1119 Terms'), ('SETTING', 'legal.intermediary_notice', 'value', 'T1119 intermediary notice'),
             ('POLL', POLL, 'title', 'T1119 poll'), ('POLL_OPT', OPT, 'label', 'T1119 option'), ('INGREDIENT', 'VITC', 'name', 'T1119 Vitamin C'),
             ('HLT_CONCERN', CON, 'name', 'T1119 concern'), ('CATEGORY', CAT, 'name', 'T1119 moving'))
        for t, tid, f, txt in W:
            u = call('PUT', '/admin/i18n/translations', {'targetType': t, 'targetId': tid, 'field': f, 'lang': 'en', 'text': txt}, TA)
            if u.get('id'):
                made.append(u['id']); call('POST', f"/admin/i18n/translations/{u['id']}/approve", t=TA)
        ok(f'③ 번역 넣기 · 승인 {len(W)}건', len(made) == len(W) and psql(f"SELECT count(*) FROM content_translations WHERE id = ANY('{{{','.join(made)}}}'::bigint[]) AND status = 'APPROVED'") == str(len(W)), str(made))
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)   # overlay 설정 기억(30초)
        EN = {'X-Lang': 'en'}
        fe, fk = call('GET', '/footer-links', h=EN), call('GET', '/footer-links')
        ok('③ 바닥줄 — 영어 번역 · 한국어 그대로 · _id 없음', fe[0].get('label') == 'T1119 Terms' and fk[0].get('label') == '이용약관' and '_id' not in fe[0] and '_id' not in fk[0], f"{fe[0].get('label')} · {fk[0].get('label')}")
        se_, sk_ = call('GET', '/site-settings/public', h=EN), call('GET', '/site-settings/public')
        ok('③ 법정 고지 — 영어 번역 · 한국어 그대로', se_.get('legal.intermediary_notice') == 'T1119 intermediary notice' and '통신판매중개자' in (sk_.get('legal.intermediary_notice') or ''), str(se_.get('legal.intermediary_notice'))[:60])
        pe = next((p for p in call('GET', '/community/polls?scope=home', h=EN) if p['id'] == POLL), {})
        pk = next((p for p in call('GET', '/community/polls?scope=home') if p['id'] == POLL), {})
        pad = next((p for p in (call('GET', '/admin/community/polls', t=TA, h=EN).get('items') or []) if p['id'] == POLL), {})
        ok('③ 투표 — 영어 질문 · 보기 번역 · 한국어 그대로 · 운영 목록은 원문', pe.get('title') == 'T1119 poll' and any(o['label'] == 'T1119 option' for o in pe.get('options', []))
           and pk.get('title') != 'T1119 poll' and pad.get('title') == pk.get('title'), f"{pe.get('title')} · {pad.get('title')}")
        ie = next((g for g in call('GET', '/health/ingredients', h=EN) if g['code'] == 'VITC'), {})
        ik = next((g for g in call('GET', '/health/ingredients') if g['code'] == 'VITC'), {})
        de = call('GET', '/health/ingredients/VITC', h=EN)
        ok('③ 성분 — 목록 · 상세 영어 · 한국어 그대로', ie.get('name') == 'T1119 Vitamin C' and de.get('name') == 'T1119 Vitamin C' and ik.get('name') == '비타민C', f"{ie.get('name')} · {ik.get('name')}")
        pr = [p for p in call('GET', '/health/products', h=EN) if (p.get('mainIngredient') or {}).get('code') == 'VITC']
        ok('③ 상품 카드의 대표 성분 이름도 영어', pr and all(p['mainIngredient']['name'] == 'T1119 Vitamin C' for p in pr), str(len(pr)))
        ce = next((k for k in call('GET', '/health/concerns', h=EN) if k['code'] == CON), {}); cde = call('GET', f'/health/concerns/{CON}', h=EN)
        ck = next((k for k in call('GET', '/health/concerns') if k['code'] == CON), {})
        ok('③ 고민 — 목록 · 상세 영어 · 한국어 그대로', ce.get('name') == 'T1119 concern' and cde.get('name') == 'T1119 concern' and ck.get('name') != 'T1119 concern', f"{ce.get('name')} · {ck.get('name')}")
        ge = next((c for c in call('GET', '/consult/categories', h=EN) if c['id'] == CAT), {}); gd = call('GET', f'/consult/categories/{CATC}', h=EN)
        gk = next((c for c in call('GET', '/consult/categories') if c['id'] == CAT), {})
        ok('③ 상담 업종 — 목록 · 상세 영어 · 한국어 그대로', ge.get('name') == 'T1119 moving' and gd.get('name') == 'T1119 moving' and gk.get('name') != 'T1119 moving', f"{ge.get('name')} · {gd.get('name')} · {gk.get('name')}")
    finally:
        if made: psql(f"DELETE FROM content_translations WHERE id = ANY('{{{','.join(made)}}}'::bigint[]);")
        en0, act0 = before.split(',')
        psql(f"UPDATE site_settings SET value='{en0}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
