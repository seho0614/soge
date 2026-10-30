"""오픈 전체 리허설 (v10.148 · sgb-core docs/228) — 점검판 전용

  python3 rehearse_open.py on       # A. 오픈 날처럼 켜기 — 운영 화면 API 로(지키는 규칙을 그대로 거침) · 업체 키가 없는 곳은 점검판 가짜(MOCK)
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
        'agent.chat.member_lookup.enabled', 'agent.chat.drafts.enabled', 'etax.require_config', 'notify.require_mail_test']
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
            'settings': {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS},
            'integrations': {c: psql(f"SELECT status FROM integrations WHERE code = '{c}'") for c in INTEG},
            'templates': psql("SELECT coalesce(json_agg(json_build_object('code', code, 'vc', vendor_code, 'st', review_state)), '[]') FROM alimtalk_templates"),
        }
        json.dump(before, open(SAVE, 'w'), ensure_ascii=False, indent=1)
    T = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    sv = lambda k, v: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, T)
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
    step('2-payment', '간주 끄기 assume.payment', sv('assume.payment', 'off'))
    # 3. 방식 — 키가 없으니 점검판 가짜(MOCK) · 알림톡은 템플릿 승인(업체 코드)이 있어야 켜짐
    # 본인인증은 STUB 그대로 — 흐름 시험이 「PASS 로 본인인증」(STUB 단추)으로 회원을 만듦 · MOCK 표준창은 test_v1141 이 따로 봄(1차 리허설에서 확인)
    step('3-identity', '본인인증 방식 STUB 유지(운영은 NICE · 가짜 표준창은 test_v1141)', sv('identity.provider', 'STUB'))
    step('3-esign', '전자계약 MOCK(운영은 HTTP)', sv('esign.provider', 'MOCK'))
    step('3-safenum', '안심번호 MOCK(운영은 HTTP)', sv('safenum.provider', 'MOCK'))
    step('3-alimtalk', '알림톡 MOCK(운영은 HTTP)', sv('alimtalk.provider', 'MOCK'))
    psql("UPDATE alimtalk_templates SET vendor_code = 'REH-' || code, review_state = 'APPROVED'")
    step('3-alimtalk-ready', '알림톡 준비 켜기(템플릿 승인 뒤)', sv('notify.alimtalk_ready', 'on'))
    # 4. 메일 — SES 인증 뒤 켜는 스위치(점검판은 SMTP 키 없음 → 개발 방식 대체가 동작)
    # v10.154 (D147) — 점검판엔 SMTP 키 · 시험 메일 성공이 없어 잠금이 막음 → 리허설에서만 잠금을 끄고 켬(운영은 시험 메일 성공 뒤 잠금 그대로)
    step('4-mail-lock', '메일 켜기 전 시험 메일 확인 off(점검판만 — SMTP 키 없음)', sv('notify.require_mail_test', 'off'))
    step('4-mail', '메일 발송 인증 켜기', sv('notify.email_verified', 'on'))
    # 5. AI — 처리방침 → 키(점검판 AGENT_PROVIDER=MOCK) · 월 상한 → AI 전체 → 단계
    # v10.151(D145) — 처리방침 1.1 게시 전에는 AI 전체가 거절되는지 먼저 보고, 점검판에는 게시가 없으니 확인 스위치를 끄고 이어 감
    step('5-cap', 'AI 월 상한', sv('agent.monthly_cap_usd', '10'))
    if psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' AND string_to_array(version, '.')::int[] >= ARRAY[1,1]") == '0':
        r = sv('agent.enabled', 'on')
        step('5-gate', 'AI 전체 — 처리방침 1.1 게시 전 거절(PRIVACY_FIRST 기대)', {} if (isinstance(r, dict) and r.get('code') == 'PRIVACY_FIRST') else {'_err': 'not blocked', 'code': r.get('code') if isinstance(r, dict) else None})
        step('5-gate-off', 'AI 켜기 전 처리방침 확인 끄기(점검판 — 게시 없음)', sv('agent.require_privacy', 'off'))
    for k in ('agent.enabled', 'agent.review_shadow.enabled', 'agent.chat.enabled', 'agent.chat.member_lookup.enabled', 'agent.chat.drafts.enabled'):
        step('5-' + k.split('.', 1)[1], f'AI 스위치 {k}', sv(k, 'on'))
    # 6. 소개비 — PASS · BANK LIVE 전에는 막혀야 함(막히는 게 맞음)
    r = sv('feature.referral_fee', 'on')
    step('6-fee', '소개비 스위치 — LIVE 전 막힘(SWITCH_PREREQ 기대)', {} if (isinstance(r, dict) and r.get('_err')) else {'_err': 'opened before LIVE'})
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
        psql(f"UPDATE site_settings SET value = $q${v}$q$ WHERE key = '{k}'")
    for c, s in before['integrations'].items():
        if s: psql(f"UPDATE integrations SET status = '{s}' WHERE code = '{c}'")
    for t in json.loads(before['templates']):
        vc = 'NULL' if t['vc'] is None else f"$q${t['vc']}$q$"
        psql(f"UPDATE alimtalk_templates SET vendor_code = {vc}, review_state = '{t['st']}' WHERE code = '{t['code']}'")
    bad = [k for k, v in before['settings'].items() if psql(f"SELECT value FROM site_settings WHERE key = '{k}'") != v]
    print('되돌림', '끝' if not bad else f'다름: {bad}')
    if not bad: os.remove(SAVE)


{'on': on, 'gate': gate, 'restore': restore}[sys.argv[1] if len(sys.argv) > 1 else 'on']()
