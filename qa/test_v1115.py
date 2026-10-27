"""v10.115 시험 — 관심 성향 동의를 맞춤형 광고 약관(ADPERSONAL) 하나로(D123 · docs/179)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1115.py

  ① 마이그레이션 D123 — 약관 하나로 · 철회하면 정리 · 광고 기록은 익명화만 허용 · 학습은 동의 뒤 클릭만 · 근거 없는 성향 정리 · 161
  ② 코드 — 등록이 약관 동의를 기록 · 해지 = 철회 · 광고 고르기 · 기록은 동의가 있을 때만 · 비동의자는 성향 지정 없는 소재만 · 답 검사 · 문구
  ③ (API · DB) 답 검사 · 동의 없이 등록 막힘 · 등록 = 약관 동의 · 내 성향 · persona · 광고 · 약관 철회 → 정리 · 해지 → 철회 · 감시 0
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D123_profile_consent_single/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 161 · 마지막 D123(v10.118 부터 D124 · 162 — test_v1118)', (len(mig), mig[-1] if mig else '') in ((161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 성향 저장 둑이 약관 ADPERSONAL 의 지금 동의를 봄 · 학습 · 감시도 같은 기준',
   'CREATE OR REPLACE FUNCTION public.fn_adpersonal_on' in M and "IF NOT public.fn_adpersonal_on(NEW.account_id) THEN" in M
   and 'AND public.fn_adpersonal_on(p.account_id)' in M and "NOT public.fn_consent_at(s.account_id, 'ADPERSONAL', s.applied_at)" in M, '')
ok('① 약관을 끄면 성향 삭제 · 광고 기록 익명화(정리할 기록이 있을 때만) · 트리거',
   "IF NEW.term_code = 'ADPERSONAL' AND NOT NEW.agreed THEN" in M and 'PERFORM public.fn_ad_anonymize(NEW.account_id);' in M
   and 'CREATE TRIGGER trg_adpersonal_withdrawn AFTER INSERT ON public.term_agreements' in M, '')
ok('① 광고 기록은 회원 칸 비우기만 허용 — 과금 칸은 비교해 그대로여야 · 지우기는 막힘',
   "(to_jsonb(NEW) - 'account_id' - 'member_hash' - 'anonymized_at')" in M and "RAISE EXCEPTION 'AD: 광고 집계 기록은 수정·삭제할 수 없습니다 (과금 근거)';" in M
   and "TG_OP = 'UPDATE'" in M, '')
ok('① 학습은 등록(동의) 뒤 클릭만 · C942 의 ambiguous 칸 유지 · 근거 없는 성향 정리',
   'AND e.occurred_at >= p.consented_at' in M and 'AS ambiguous' in M and 'DELETE FROM public.member_ad_profiles p WHERE NOT public.fn_adpersonal_on(p.account_id);' in M, '')
ok('① 독립 검토 반영 — 등록 · 철회 차례 지키기(회원 단위 잠금) · 학습은 약관 동의와 한 번 JOIN · 정리 때 광고 기록 익명화 · 동의 없던 학습 기록은 되돌림 표시',
   M.count("pg_advisory_xact_lock(hashtext('adpersonal:' || NEW.account_id::text))") == 2 and "JOIN public.v_term_consent_current tc" in M
   and 'SELECT public.fn_ad_anonymize(x.account_id)' in M and 'UPDATE public.segment_shift_log s SET reverted_at = now()' in M, '')
S = rd('src/modules/ads/ads.service.ts'); A = rd('src/modules/ai/ai.service.ts'); P = rd('site/src/components/ProfileSurvey.tsx')
ok('② 가입 5단계 — 4단계에서 맞춤형 광고에 동의한 경우에만 성향 저장(4단계 「동의 안 함」을 뒤집지 않음)',
   "if (seg && segOk && agreed.has('ADPERSONAL') && Object.keys(ans).length) {" in rd('site/src/components/auth/SignupWizard.tsx'), '')
ok('② 등록 = 약관 동의 기록(같은 트랜잭션) · 약관 발행 전이면 CONSENT_UNAVAILABLE · 다시 등록하면 출처 MEMBER',
   "await this.compliance.agree([{ code: 'ADPERSONAL', agreed: true }]);" in S and "'CONSENT_UNAVAILABLE'" in S and "consented_at = now(), source = 'MEMBER'" in S, '')
ok('② 해지 = 철회 기록 · 광고 고르기 · 기록은 동의가 있을 때만 · 비동의자는 성향 지정 없는 소재만',
   "await this.compliance.agree([{ code: 'ADPERSONAL', agreed: false }]);" in S and 'AND fn_adpersonal_on(account_id)' in S
   and "(($2::text IS NULL AND cardinality(segments) = 0) OR $2 = ANY(segments))" in S and 'const segCode = await this.mySegment();' in S, '')
ok('② 답 검사(있는 문항 · 보기 · 한 개만 · 중복 · 크기) · persona 는 저장된 성향', "'BAD_ANSWER'" in S and 'Object.keys(answers).length > 20' in S
   and '(!def.multi && arr.length > 1)' in S and 'fn_derive_segment' not in A and 'FROM member_ad_profiles WHERE account_id = $1' in A, '')
KJ = json.load(open(os.path.join(K, 'site/src/i18n/messages/ko/join.json'), encoding='utf-8'))
ok('② 문구 — 「행동 데이터를 보지 않습니다」 · 「추천 정렬」 없음 · 동의 = 맞춤형 광고 · 약관 전문 링크 · 다시 하기 상태 정리',
   '행동 데이터를 보지 않습니다' not in json.dumps(KJ, ensure_ascii=False) and '추천 정렬' not in json.dumps(KJ['profileSurvey'], ensure_ascii=False)
   and '맞춤형 광고에 동의합니다' in KJ['profileSurvey']['agree'] and 'href="/terms/ADPERSONAL"' in P and 'setAgree(false); setSkipped(false);' in P, '')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
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
    EM = 'seller@x.com'
    T = call('POST', '/auth/login', {'email': EM, 'password': 'sgb-dev-1234'})['accessToken']
    ME = psql(f"SELECT id FROM accounts WHERE email = '{EM}'")
    pub = psql("SELECT count(*) FROM terms WHERE code = 'ADPERSONAL' AND status = 'PUBLISHED'")
    ok('③ 점검판 약관 ADPERSONAL 발행됨(시험 전제)', pub == '1', pub)
    good = {'q1': ['re'], 'q2': [psql("SELECT code FROM profile_options WHERE question_code = 'q2' ORDER BY sort_order LIMIT 1")]}
    call('DELETE', '/me/profile', t=T)
    bad = [call('POST', '/profile/analyze', {'answers': a}, T) for a in (
        {'q1': ['zz']}, {'qX': ['re']}, {'q2': [good['q2'][0], psql("SELECT code FROM profile_options WHERE question_code = 'q2' ORDER BY sort_order OFFSET 1 LIMIT 1")]}, {'q1': ['re', 're']})]
    ok('③ 답 검사 — 없는 보기 · 없는 문항 · 한 개만 고르는 문항에 2개 · 중복 → 422 BAD_ANSWER', all(x.get('_err') == 422 and x.get('code') == 'BAD_ANSWER' for x in bad), str([(x.get('_err'), x.get('code')) for x in bad]))
    big = call('POST', '/signup/profile-analyze', {'answers': {f'k{i}': ['x'] for i in range(500)}})
    ok('③ 공개 진단에 큰 입력 → 422(500 아님)', big.get('_err') == 422, str(big.get('_err')))
    an = call('POST', '/profile/analyze', {'answers': good}, T)
    ok('③ 바른 답 → 진단(저장 안 함) · 「광고를 고르는 데만」', an.get('saved') is False and '광고를 고르는 데만' in (an.get('note') or ''), str(an.get('code')))
    no = call('POST', '/me/profile', {'answers': good, 'consent': False}, T)
    ok('③ 동의 없이 등록 → 422 CONSENT_REQUIRED', no.get('code') == 'CONSENT_REQUIRED', str(no))
    rg = call('POST', '/me/profile', {'answers': good, 'consent': True}, T)
    cons = psql(f"SELECT agreed FROM v_term_consent_current WHERE account_id = '{ME}' AND term_code = 'ADPERSONAL'")
    src = psql(f"SELECT source FROM member_ad_profiles WHERE account_id = '{ME}'")
    ok('③ 등록 = 약관 동의 기록(지금 동의 t) · 출처 MEMBER', rg.get('segment') and cons == 't' and src == 'MEMBER', f'{rg.get("segment")} · {cons} · {src}')
    mine = call('GET', '/me/profile', t=T); per = call('GET', '/me/persona', t=T)
    ok('③ 내 성향 · persona 가 같은 값', mine.get('registered') is True and per.get('segment') == mine.get('segment') == rg.get('segment'), f'{mine.get("segment")} · {per.get("segment")}')
    g = call('GET', '/ads/serve?slot=HERO')
    gseg = psql(f"SELECT cardinality(segments) FROM v_ad_serving WHERE id = '{g.get('id')}'") if g.get('id') else '0'
    ok('③ 비회원 — 성향을 겨냥한 소재는 나가지 않음', g.get('empty') or gseg == '0', f"{g.get('code')} · segs {gseg}")
    m = call('GET', '/ads/serve?slot=HERO', t=T)
    ok('③ 동의한 회원 — 성향이 맞으면 matchedSegment = 내 성향(없으면 기본 소재)', m.get('empty') or m.get('matchedSegment') in (rg.get('segment'), None), f"{m.get('code')} · {m.get('matchedSegment')}")
    if m.get('id'):
        call('POST', f"/ads/{m['id']}/click?slot=HERO", t=T)
    ev = psql(f"SELECT count(*) FROM ad_events WHERE account_id = '{ME}'")
    wd = call('POST', '/terms/agree', {'items': [{'code': 'ADPERSONAL', 'agreed': False}]}, T)
    after = psql(f"SELECT (SELECT count(*) FROM member_ad_profiles WHERE account_id = '{ME}') || ' ' || (SELECT count(*) FROM ad_events WHERE account_id = '{ME}')")
    ok('③ 약관 화면에서 철회 → 성향 삭제 · 광고 기록 회원 연결 0', 'ADPERSONAL' in (wd.get('saved') or []) and after == '0 0', f'기록 전 {ev} · 뒤 {after}')
    m2 = call('GET', '/ads/serve?slot=HERO', t=T); m2seg = psql(f"SELECT cardinality(segments) FROM v_ad_serving WHERE id = '{m2.get('id')}'") if m2.get('id') else '0'
    ok('③ 철회 뒤 — 내 성향 없음 · 성향 겨냥 소재 안 나감', call('GET', '/me/profile', t=T).get('registered') is False and (m2.get('empty') or m2seg == '0'), f"{m2.get('code')} · segs {m2seg}")
    call('POST', '/me/profile', {'answers': good, 'consent': True}, T)
    dl = call('DELETE', '/me/profile', t=T)
    cons2 = psql(f"SELECT agreed FROM v_term_consent_current WHERE account_id = '{ME}' AND term_code = 'ADPERSONAL'")
    ok('③ 「성향 쓰지 않기」(해지) = 철회 기록 · 성향 삭제', dl.get('deleted') is True and cons2 == 'f' and psql(f"SELECT count(*) FROM member_ad_profiles WHERE account_id = '{ME}'") == '0', f'{dl} · {cons2}')
    ok('③ 감시 — 약관 동의 없이 바뀐 성향 0 · 동의 없는 성향 0',
       psql('SELECT count(*) FROM v_segment_learn_no_consent') == '0' and psql('SELECT count(*) FROM member_ad_profiles WHERE NOT fn_adpersonal_on(account_id)') == '0', '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
