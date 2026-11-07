"""오픈 전체 리허설 (v10.148 · sgb-core docs/228) — 점검판 전용

  python3 rehearse_open.py on       # A. 오픈 날처럼 켜기 — 운영 화면 API 로(지키는 규칙을 그대로 거침) · 업체 키가 없는 곳은 점검판 가짜(MOCK)
                                    #    11/7 갱신(v10.211 기준 · docs/228 7절): 주문 받기 · 동네픽 · 메일 반송 받기 · 회원 투표 켜기 / 동네 인증 · 입점 신청은 막히는지
  (그다음 func_check.sh 의 흐름 시험 · 화면 돌기)
  python3 rehearse_open.py gate     # B. 오픈 문 — 업체 LIVE · NICE · HTTP 를 DB 에 직접 넣고 오픈 차단 · open-check.sh 가 무엇을 보는지
  python3 rehearse_open.py restore  # 처음 값으로 되돌림(on 때 적어 둔 파일)

  env: API(기본 http://localhost:13000/api/v1) · DB(기본 점검판 15432) · OUT(결과 폴더 · 기본 ./out)
  운영 서버 · RDS 에는 쓰지 않습니다 — DB 주소가 점검판(localhost:15432)이 아니면 멈춥니다.
"""
import json, os, subprocess, sys, urllib.error, urllib.request

API = os.environ.get('API', 'http://localhost:13000/api/v1')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:15432/sgb')
OUT = os.environ.get('OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
PW = 'sgb-dev-1234'
if 'localhost:15432' not in DB:
    sys.exit('점검판 DB(localhost:15432)가 아닙니다 — 멈춤')
os.makedirs(OUT, exist_ok=True)
SAVE = os.path.join(OUT, 'rehearse_before.json')
LOG = []

# 오픈 날 바꾸는 설정(되돌릴 목록)
KEYS = ['assume.payment', 'assume.broker', 'assume.bank', 'assume.etax', 'company.bank_name', 'company.bank_account', 'company.bank_holder',
        'identity.provider', 'alimtalk.provider', 'notify.alimtalk_ready', 'esign.provider', 'safenum.provider', 'notify.email_verified',
        'notify.mail_from', 'feature.referral_fee', 'agent.require_privacy', 'agent.monthly_cap_usd', 'agent.enabled', 'agent.review_shadow.enabled', 'agent.chat.enabled',
        'agent.chat.member_lookup.enabled', 'agent.chat.drafts.enabled', 'etax.require_config', 'notify.require_mail_test',
        # 11/7 갱신(v10.211 기준) — v10.156 뒤 생긴 오픈 날 스위치(docs/228 7절)
        'mall.order_open', 'mall.order_open_until', 'mall.tenant', 'community.town_verify', 'community.lbs_report_no', 'agent.town_pick.enabled',
        'notify.ses_feedback', 'notify.ses_topic_arn', 'poll.member_create', 'admin.mfa_required', 'signup.open']
NUL = '<NULL>'   # 비어 있는(NULL) 설정 — 되돌릴 때 '' 가 아니라 NULL 로(형식 검사 트리거가 '' 를 막음)
INTEG = ['PASS', 'BANK', 'PG', 'BROKER', 'ETAX', 'ALIMTALK', 'ESIGN', 'SAFENUM', 'MAIL', 'AGENT']


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode:
        print('  psql:', r.stderr.strip()[:300])
    return r.stdout.strip()


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': str(body.get('message'))[:160]}


def step(n, what, res):
    good = not (isinstance(res, dict) and res.get('_err'))
    LOG.append({'step': n, 'what': what, 'ok': good, 'res': res if not good else None})
    print(f"{'ok  ' if good else 'STOP'} {n} {what}" + ('' if good else f" — {res.get('_err')} {res.get('code')} {res.get('message')}"), flush=True)
    return good


def blockers():
    return psql("SELECT kind || ' | ' || item FROM v_open_blockers ORDER BY 1").splitlines()


def readiness():
    return psql("SELECT code || ' ' || CASE WHEN ok THEN 'ok' ELSE 'NO' END || ' (' || now_value || ')' FROM v_open_readiness ORDER BY sort").splitlines()


def on():
    if not os.path.exists(SAVE):
        before = {
            'settings': {k: psql(f"SELECT coalesce(value, '{NUL}') FROM site_settings WHERE key = '{k}'") for k in KEYS},
            'integrations': {c: psql(f"SELECT status FROM integrations WHERE code = '{c}'") for c in INTEG},
            'templates': psql("SELECT coalesce(json_agg(json_build_object('code', code, 'vc', vendor_code, 'st', review_state)), '[]') FROM alimtalk_templates"),
        }
        json.dump(before, open(SAVE, 'w'), ensure_ascii=False, indent=1)
    T = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    sv = lambda k, v, **x: call('PATCH', '/admin/site-settings', {'key': k, 'value': v, **x}, T)
    ig = lambda c, s: call('PATCH', f'/admin/integrations/{c}', {'status': s}, T)
    print('== 켜기 전 오픈 차단', len(blockers()))

    # 1. 회사 수금 계좌(시험용 아닌 값) → assume.bank 는 DB 가 스스로 끔
    step('1-1', '회사 계좌 3칸(리허설 값)', sv('company.bank_name', '리허설은행') and sv('company.bank_account', '123456-01-123456') and sv('company.bank_holder', '(주)한국바이오헬스케어'))
    step('1-2', 'assume.bank 가 꺼졌는지(트리거)', {} if psql("SELECT value FROM site_settings WHERE key = 'assume.bank'") == 'off' else {'_err': 'still on'})
    # 2. 업체 상태를 시험(TESTING)으로 → 간주 끄기 (docs/111 6절 순서 etax → broker → payment)
    for c in ('BROKER', 'ETAX', 'PASS', 'BANK'):
        step('2-' + c, f'연동 {c} → TESTING', ig(c, 'TESTING'))
    # v10.153 (D146) — 점검판엔 업체 주소 · 키(ETAX_URL · ETAX_KEY)가 없어 잠금이 막음 → 리허설에서만 잠금을 끄고 끔(운영은 주소 · 키를 넣고 잠금 그대로)
    step('2-etax-lock', '간주 끄기 전 설정 확인 off(점검판만 — ETAX_URL 없음)', sv('etax.require_config', 'off'))
    step('2-etax', '간주 끄기 assume.etax', sv('assume.etax', 'off'))
    step('2-broker', '간주 끄기 assume.broker', sv('assume.broker', 'off'))
    # v10.195 · v10.199 (D174 · D177) — 간주 결제가 켜진 채 주문 받기를 켜면 확인 문구 · 사유 · 꺼질 시각이 필요(막히는 것만 봄)
    if psql("SELECT value FROM site_settings WHERE key = 'assume.payment'") == 'on':
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
        r = sv('mall.order_open', 'on')
        step('2-order-confirm', '간주 결제 켜짐에 주문 받기 — 확인 문구 없이 막힘(ORDER_OPEN_CONFIRM 기대)', {} if r.get('code') == 'ORDER_OPEN_CONFIRM' else {'_err': 'not blocked', 'code': r.get('code')})
    step('2-payment', '간주 끄기 assume.payment', sv('assume.payment', 'off'))
    # 간주 결제가 꺼진 뒤 주문 받기 — SUPER 만 · 확인 문구 · 꺼질 시각 없이(실결제)
    step('2-order', '소개몰 주문 받기 켜기(간주 결제 꺼진 뒤 · SUPER)', sv('mall.order_open', 'on'))
    step('2-order-until', '꺼질 시각 없음(실결제라 저절로 끄지 않음)', {} if psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'mall.order_open_until'") == '' else {'_err': 'until set'})
    # 3. 방식 — 키가 없으니 점검판 가짜(MOCK) · 알림톡은 템플릿 승인(업체 코드)이 있어야 켜짐
    # 본인인증은 STUB 그대로 — 흐름 시험이 「PASS 로 본인인증」(STUB 단추)으로 회원을 만듦 · MOCK 표준창은 test_v1141 이 따로 봄(1차 리허설에서 확인)
    step('3-identity', '본인인증 방식 STUB 유지(운영은 NICE · 가짜 표준창은 test_v1141)', sv('identity.provider', 'STUB'))
    step('3-esign', '전자계약 MOCK(운영은 HTTP)', sv('esign.provider', 'MOCK'))
    step('3-safenum', '안심번호 MOCK(운영은 HTTP)', sv('safenum.provider', 'MOCK'))
    step('3-alimtalk', '알림톡 MOCK(운영은 HTTP)', sv('alimtalk.provider', 'MOCK'))
    psql("UPDATE alimtalk_templates SET vendor_code = 'REH-' || code, review_state = 'APPROVED'")
    # v10.155 (D148) — 켜기 전 지금 방식(MOCK)으로 시험 발송 성공이 있어야 함(alimtalk.require_test on) — 운영도 같은 순서(HTTP 로 시험 발송 → 켜기)
    tr = call('POST', '/admin/alimtalk/test', {'to': '01000000000', 'template': 'NOTICE_GENERAL'}, T)
    step('3-alimtalk-test', '알림톡 시험 발송(MOCK · 밖으로 안 나감)', tr if tr.get('_err') or tr.get('ok') else {'_err': 'not ok', 'code': tr.get('errorKind'), 'message': tr.get('error')})
    step('3-alimtalk-ready', '알림톡 준비 켜기(템플릿 승인 뒤)', sv('notify.alimtalk_ready', 'on'))
    # 4. 메일 — SES 인증 뒤 켜는 스위치(점검판은 SMTP 키 없음 → 개발 방식 대체가 동작)
    # v10.154 (D147) — 점검판엔 SMTP 키 · 시험 메일 성공이 없어 잠금이 막음 → 리허설에서만 잠금을 끄고 켬(운영은 시험 메일 성공 뒤 잠금 그대로)
    step('4-mail-lock', '메일 켜기 전 시험 메일 확인 off(점검판만 — SMTP 키 없음)', sv('notify.require_mail_test', 'off'))
    step('4-mail', '메일 발송 인증 켜기', sv('notify.email_verified', 'on'))
    # 5. AI — 처리방침 → 키(점검판 AGENT_PROVIDER=MOCK) · 월 상한 → AI 전체 → 단계
    # v10.151(D145) — 처리방침 1.1 게시 전에는 AI 전체가 거절되는지 먼저 보고, 점검판에는 게시가 없으니 확인 스위치를 끄고 이어 감
    step('5-cap', 'AI 월 상한', sv('agent.monthly_cap_usd', '10'))
    # 11/7 — v10.156(D149) 뒤로는 판 번호가 아니라 fn_privacy_ai_ready()(게시된 처리방침에 국외 이전 조항)로 판단 · 점검판은 이미 게시라 건너뜀
    if psql("SELECT fn_privacy_ai_ready()") != 't':
        r = sv('agent.enabled', 'on')
        step('5-gate', 'AI 전체 — 국외 이전 조항 든 처리방침 게시 전 거절(PRIVACY_FIRST 기대)', {} if (isinstance(r, dict) and r.get('code') == 'PRIVACY_FIRST') else {'_err': 'not blocked', 'code': r.get('code') if isinstance(r, dict) else None})
        step('5-gate-off', 'AI 켜기 전 처리방침 확인 끄기(점검판 — 게시 없음)', sv('agent.require_privacy', 'off'))
    for k in ('agent.enabled', 'agent.review_shadow.enabled', 'agent.chat.enabled', 'agent.chat.member_lookup.enabled', 'agent.chat.drafts.enabled'):
        step('5-' + k.split('.', 1)[1], f'AI 스위치 {k}', sv(k, 'on'))
    # 6. 소개비 — PASS · BANK LIVE 전에는 막혀야 함(막히는 게 맞음)
    r = sv('feature.referral_fee', 'on')
    step('6-fee', '소개비 스위치 — LIVE 전 막힘(SWITCH_PREREQ 기대)', {} if (isinstance(r, dict) and r.get('_err')) else {'_err': 'opened before LIVE'})
    # 7. 11/7 갱신(v10.211 기준) — v10.156 뒤 생긴 스위치(docs/228 7절) · 규칙을 그대로 거침
    # 7-1 동네픽 AI(v10.211) — AI 전체 뒤 · MOCK 공급자로 한 번 고르기(점검판은 글이 적어 0개도 정상)
    step('7-townpick', '동네픽 AI 켜기 agent.town_pick.enabled', sv('agent.town_pick.enabled', 'on'))
    tp = call('POST', '/admin/community/town-picks/run', None, T)
    step('7-townpick-run', '동네픽 지금 고르기(통로 열림 · skipped 없음)', tp if tp.get('_err') else ({} if not (tp.get('detail') or {}).get('skipped') else {'_err': 'skipped', 'code': tp['detail']['skipped']}))
    # 7-2 메일 반송 받기(v10.209) — 주제 없이 켜도 받지 않음 → 주제를 넣고 켬 → 서명 없는 알림은 401(검사가 도는 것)
    step('7-ses-topic', 'SNS 주제(리허설 값)', sv('notify.ses_topic_arn', 'arn:aws:sns:ap-northeast-2:000000000000:sgb-ses-feedback-rehearsal'))
    step('7-ses', '메일 반송 받기 켜기 notify.ses_feedback', sv('notify.ses_feedback', 'on'))
    rq = urllib.request.Request(API + '/webhooks/ses', method='POST', headers={'content-type': 'text/plain'}, data=json.dumps({
        'Type': 'Notification', 'MessageId': 'rehearsal-1', 'TopicArn': 'arn:aws:sns:ap-northeast-2:000000000000:sgb-ses-feedback-rehearsal', 'Message': '{}',
        'Timestamp': '2026-11-07T00:00:00Z', 'SignatureVersion': '2', 'Signature': 'AAAA', 'SigningCertURL': 'https://example.com/x.pem'}).encode())
    try:
        urllib.request.urlopen(rq, timeout=30); wh = 200
    except urllib.error.HTTPError as e:
        wh = e.code
    step('7-ses-sig', '서명 없는 SNS 알림 → 401(서명 검사 동작)', {} if wh == 401 else {'_err': wh})
    # 7-3 동네 인증(v10.210) — 위치 약관 게시 · 신고번호 없이는 DB 가 막음(막히는 게 맞음 · 운영은 신고 · 법무 뒤)
    r = sv('community.town_verify', 'on')
    rd = call('GET', '/admin/community/town-verify/readiness', None, T)
    step('7-town', '동네 인증 — 약관 · 신고번호 전 막힘(INVALID_SETTING 기대) · 준비 상태 canTurnOn=false',
         {} if (r.get('code') == 'INVALID_SETTING' and rd.get('canTurnOn') is False) else {'_err': 'not blocked', 'code': r.get('code'), 'message': str(rd)[:120]})
    # 7-4 소개몰 입점 신청(v10.202) — 입점 약관(HLT_SELLER) 게시 전 막힘
    if psql("SELECT count(*) FROM v_terms_current WHERE code = 'HLT_SELLER'") == '0':
        r = sv('mall.tenant', 'on')
        step('7-tenant', '입점 신청 — 입점 약관 게시 전 막힘(TENANT_TERMS_FIRST 기대)', {} if r.get('code') == 'TENANT_TERMS_FIRST' else {'_err': 'not blocked', 'code': r.get('code')})
    else:
        step('7-tenant', '입점 신청 켜기(입점 약관 게시됨)', sv('mall.tenant', 'on'))
    # 7-5 회원 투표 만들기(v10.177 · 오픈 뒤 켜기 권함)
    step('7-poll', '회원 투표 만들기 켜기 poll.member_create', sv('poll.member_create', 'on'))
    # 7-6 켜지 않고 값만 보는 것 — 운영자 2단계 인증(켜면 흐름 시험의 운영 로그인이 멈춤) · 가입 열림 · 텔레그램(토큰 없음)
    keep = ('admin.mfa_required', 'signup.open', 'ops.telegram_chat', 'ops.telegram_digest', 'ops.staff_login_alert')
    print('== 그대로 둔 스위치:', ' · '.join(k + '=' + psql(f"SELECT coalesce(value, '∅') FROM site_settings WHERE key = '{k}'") for k in keep))
    ro = call('GET', '/admin/agent/rollout', t=T)
    print('== AI 안내판:', ' · '.join(f"{x['code']}={x['state']}{'(early)' if x['early'] else ''}" for x in ro) if isinstance(ro, list) else ro)
    print('== 오픈 준비 점검:'); [print('   ', x) for x in readiness()]
    b = blockers(); print('== 켠 뒤 오픈 차단', len(b)); [print('   ', x) for x in b]
    json.dump(LOG, open(os.path.join(OUT, 'rehearse_on.json'), 'w'), ensure_ascii=False, indent=1)


def gate():
    # 업체 응답 없이 갈 수 없는 값은 DB 에 직접(운영에서는 실제 시험이 이 값을 만듦)
    psql("UPDATE integrations SET status = 'LIVE' WHERE code IN ('PASS', 'BANK', 'PG', 'BROKER', 'ETAX')")
    psql("UPDATE site_settings SET value = 'NICE' WHERE key = 'identity.provider'")
    for k in ('alimtalk.provider', 'esign.provider', 'safenum.provider'):
        psql(f"UPDATE site_settings SET value = 'HTTP' WHERE key = '{k}'")
    print('== 오픈 준비 점검:'); [print('   ', x) for x in readiness()]
    b = blockers(); print('== 오픈 차단', len(b)); [print('   ', x) for x in b]
    json.dump({'blockers': b, 'readiness': readiness()}, open(os.path.join(OUT, 'rehearse_gate.json'), 'w'), ensure_ascii=False, indent=1)


def restore():
    before = json.load(open(SAVE))
    for k, v in before['settings'].items():
        if v == '': continue   # 리허설 앞 판에 없던 키
        psql(f"UPDATE site_settings SET value = {'NULL' if v == NUL else f'$q${v}$q$'} WHERE key = '{k}'")
    for c, s in before['integrations'].items():
        if s: psql(f"UPDATE integrations SET status = '{s}' WHERE code = '{c}'")
    for t in json.loads(before['templates']):
        vc = 'NULL' if t['vc'] is None else f"$q${t['vc']}$q$"
        psql(f"UPDATE alimtalk_templates SET vendor_code = {vc}, review_state = '{t['st']}' WHERE code = '{t['code']}'")
    bad = [k for k, v in before['settings'].items() if v != '' and psql(f"SELECT coalesce(value, '{NUL}') FROM site_settings WHERE key = '{k}'") != v]
    print('되돌림', '끝' if not bad else f'다름: {bad}')
    if not bad: os.remove(SAVE)


{'on': on, 'gate': gate, 'restore': restore}[sys.argv[1] if len(sys.argv) > 1 else 'on']()
