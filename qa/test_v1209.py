"""v10.209 (D186 · docs/334) — 메일 반송 · 수신 거부 주소(보내지 않을 주소)

  ① (코드) D186 표 2개 · 지우기 막음 · fn_mail_suppress · 설정 2개(처음 off · 주제 비어 있음) · 웹훅(스위치 · 주제 · AWS 서명 · 구독 확인)
     · 알림 메일 SUPPRESSED · text/plain 은 웹훅 주소에만(이름 다른 함수) · API 2(ADMIN · SUPER · 감사) · 화면 · 통합 검정 시험 · 영어 · 명세 · 문서 334
  ② (DB) 마이그레이션 수 · 설정 기본값 · 지우기 막음
  ③ (API) 웹훅 꺼짐 → OFF · 켜고 주제 없음 403 · 주제 맞고 서명 틀림 401 · 로그인(본문 읽기 그대로) · 운영 목록 · 회원 403 · 풀기(짧은 사유 · 감사 · 다시 풀기 422)
  ④ (화면) 메일 구역 「반송 · 수신 거부 주소」
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
M = rd('prisma/migrations/D186_mail_suppression/migration.sql')
ok('① D186 — 보내지 않을 주소 · 받은 기록(같은 알림 한 번) · 지우기 막음 · 다시 반송되면 다시 막힘 · 스위치 off · 주제 비어 있음 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.mail_suppressions' in M and "CHECK (reason IN ('BOUNCE', 'COMPLAINT'))" in M
   and 'CONSTRAINT ux_mail_feedback_msg UNIQUE (sns_message_id)' in M and "'MAILSUP: 반송 주소 기록은 지울 수 없습니다 — 풀기를 쓰십시오.'" in M
   and 'released_at = NULL, released_by = NULL, release_note = NULL' in M and "('notify.ses_feedback', 'off'," in M and "('notify.ses_topic_arn', NULL," in M
   and not re.search(r'\b(DROP TABLE|TRUNCATE|DELETE FROM)\b', M), '')

F, SV, C, N, SH = (rd('src/common/mail/ses-feedback.ts'), rd('src/common/mail/mail-suppression.service.ts'), rd('src/modules/site/mail-feedback.controller.ts'),
                   rd('src/common/mail/notify-mail.ts'), rd('src/common/security-headers.ts'))
AM, EN, SC, VA, UT = rd('src/app.module.ts'), rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json'), rd('scripts/verify-all.sh'), rd('scripts/test-ses-feedback.ts')
ok('① 웹훅 — 꺼지면 OFF(서명 검사 전) · 주제 403 · AWS 인증서 주소만 · 서명 SHA1/SHA256 · 구독 확인 AWS 주소만 · 영구 반송 · 수신 거부만 막음',
   "!== 'on') return { ok: true, action: 'OFF' }" in F and "'SES_FEEDBACK_TOPIC'" in F and r'/^sns\.[a-z0-9-]+\.amazonaws\.com$/' in F
   and "'RSA-SHA256'" in F and "'RSA-SHA1'" in F and "snsUrlOk(m.SubscribeURL, false)" in F and "n.bounce?.bounceType === 'Permanent'" in F
   and "redirect: 'error'" in SV and 'AbortSignal.timeout(5000)' in SV, '')
ok('① 알림 메일 — 막힌 주소는 SUPPRESSED 로 닫음 · text/plain 읽기는 웹훅 주소에만(이름 다른 함수) · 공개 webhooks/ses · API 2(ADMIN · SUPER · 감사)',
   "r.suppressed ? 'SUPPRESSED: 반송 · 수신 거부된 주소'" in N and 'FROM mail_suppressions s WHERE s.email = a.email AND s.released_at IS NULL' in N
   and "app.use('/api/v1/webhooks/ses', function sesSnsBody(" in SH and "useBodyParser" not in rd('src/main.ts')
   and "@Post('webhooks/ses')" in C and "@Roles('ADMIN', 'SUPER')" in C and "@Audit('MAIL_SUPPRESS_RELEASE', 'INTEGRATION')" in C
   and 'MailFeedbackController,' in AM and 'MailSuppressionService,' in AM, '')
ok('① 통합 검정 시험 · 영어 · 명세 3줄 · 화면',
   'scripts/test-ses-feedback.ts' in VA and '메일 반송 받기 시험 — 전체 통과' in UT and '"이미 푼 주소입니다.":' in EN and '"반송 주소 기록은 지울 수 없습니다 — 풀기를 쓰십시오.":' in EN
   and '"GET /admin/mail/suppressions"' in SC and '"POST /admin/mail/suppressions/{id}/release"' in SC and '"POST /webhooks/ses"' in SC
   and 'data-mail-suppress' in rd('web/src/app/admin/MailPanel.tsx'), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('334_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 334 · 판 v10.209 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 209), f'{DOC} · {rd("VERSION").strip()}')


# ── ② · ③ · ④ ─────────────────────────────────────────────────────────
def call(m, p, b=None, t=None, raw=None, ctype='application/json'):
    hd = {'content-type': ctype}
    if t: hd['Authorization'] = 'Bearer ' + t
    data = raw.encode() if raw is not None else json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


SUPU = 'admin@x.com'; BUY = 'buyer@x.com'
TOPIC = 'arn:aws:sns:ap-northeast-2:123456789012:sgb-ses-feedback-test'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    sw0 = tp0 = None; sid = None
    try:
        mig = psql("SELECT count(*) FROM schema_migrations WHERE name = 'D186_mail_suppression'")
        st = psql("SELECT string_agg(key || '=' || coalesce(value, '∅'), ',' ORDER BY key) FROM site_settings WHERE key IN ('notify.ses_feedback', 'notify.ses_topic_arn')")
        sw0 = psql("SELECT value FROM site_settings WHERE key = 'notify.ses_feedback'"); tp0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'notify.ses_topic_arn'")
        ok('② D186 적용 · 설정 기본값(off · 비어 있음)', mig == '1' and st == 'notify.ses_feedback=off,notify.ses_topic_arn=∅', f'{mig} · {st}')

        consent_ok.agree(SUPU, PW); consent_ok.agree(BUY, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        ok('③ 로그인 토큰(JSON 본문 읽기 그대로 — text/plain 은 웹훅 주소에만)', bool(TS) and bool(TB), '')

        msg = json.dumps({'Type': 'Notification', 'MessageId': 'qa-1209', 'TopicArn': TOPIC, 'Message': '{}', 'Timestamp': '2026-11-07T00:00:00Z',
                          'SignatureVersion': '1', 'Signature': 'AAAA', 'SigningCertURL': 'https://sns.ap-northeast-2.amazonaws.com/x.pem'})
        w0 = call('POST', '/webhooks/ses', raw=msg, ctype='text/plain; charset=UTF-8')
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'notify.ses_feedback'")
        psql("UPDATE site_settings SET value = NULL WHERE key = 'notify.ses_topic_arn'")
        w1 = call('POST', '/webhooks/ses', raw=msg, ctype='text/plain; charset=UTF-8')
        psql(f"UPDATE site_settings SET value = '{TOPIC}' WHERE key = 'notify.ses_topic_arn'")
        w2 = call('POST', '/webhooks/ses', raw=msg.replace('/x.pem', '/../x.txt'), ctype='text/plain; charset=UTF-8')
        w3 = call('POST', '/webhooks/ses', raw='not json', ctype='text/plain; charset=UTF-8')
        nev = psql("SELECT count(*) FROM mail_feedback_events WHERE sns_message_id = 'qa-1209'")
        ok('③ 웹훅(text/plain · 로그인 없음) — 꺼짐 OFF · 켜고 주제 없음 403 · AWS 인증서 아님 401 · 형식 아님 400 · 기록 안 남음',
           w0.get('action') == 'OFF' and w1.get('_err') == 403 and w1.get('code') == 'SES_FEEDBACK_TOPIC' and w2.get('_err') == 401
           and w3.get('_err') == 400 and nev == '0', f'{w0} · {w1.get("_err")} {w1.get("code")} · {w2.get("_err")} {w2.get("code")} · {w3.get("_err")} · {nev}')

        sid = psql("SELECT public.fn_mail_suppress('qa-1209-bounce@t.local', 'BOUNCE', 'Permanent/General')")
        ls = call('GET', '/admin/mail/suppressions', None, TS)
        mine = [x for x in ls.get('items') or [] if x.get('id') == sid]
        mb = call('GET', '/admin/mail/suppressions', None, TB)
        e0 = call('POST', f'/admin/mail/suppressions/{sid}/release', {'note': 'x'}, TS)
        rl = call('POST', f'/admin/mail/suppressions/{sid}/release', {'note': '시험 1209 — 회원이 주소를 고쳤다고 알려 옴'}, TS)
        rl2 = call('POST', f'/admin/mail/suppressions/{sid}/release', {'note': '시험 1209 다시'}, TS)
        rs = psql(f"SELECT (released_at IS NOT NULL)::text || '|' || coalesce(release_note, '') FROM mail_suppressions WHERE id = '{sid}'")
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'MAIL_SUPPRESS_RELEASE' AND occurred_at > now() - interval '10 minutes'")
        rel = call('GET', '/admin/mail/suppressions?state=released', None, TS)
        ok('③ 운영 목록(주소 가림 · 받기 켜짐 · 주제 있음) · 회원 403 · 짧은 사유 400/422 · 풀기 · 다시 풀기 422 · 감사 · 푼 주소 목록',
           bool(mine) and mine[0].get('email') == 'qa***@t.local' and ls.get('feedback', {}).get('switchOn') is True and ls['feedback'].get('topicSet') is True
           and mb.get('_err') == 403 and e0.get('_err') in (400, 422) and rl.get('ok') is True and rl2.get('code') == 'MAIL_SUPPRESS_RELEASED'
           and rs.startswith('true|시험 1209') and au.isdigit() and int(au) >= 1 and any(x.get('id') == sid for x in rel.get('items') or []),
           f'{len(mine)} {mine[0].get("email") if mine else ""} · {mb.get("_err")} · {e0.get("_err")} · {rl} · {rl2.get("code")} · {rs} · 감사 {au}')

        dl = psql(f"BEGIN; DELETE FROM mail_suppressions WHERE id = '{sid}'; ROLLBACK;")
        ok('② 반송 주소 기록 지우기 막음(MAILSUP)', dl.startswith('!') and '지울 수 없습니다' in dl, dl[:80])

        errs, seen = [], {}
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.on('dialog', lambda d: d.dismiss())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(4000)
                seen['sec'] = pg.evaluate("() => document.querySelector('[data-mail-suppress] h3')?.textContent ?? ''")
                seen['fb'] = pg.evaluate("() => document.querySelector('[data-mail-feedback]')?.getAttribute('data-mail-feedback') ?? ''")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 외부 연동 › 메일 「반송 · 수신 거부 주소」 · 받기 켜짐 · 오류 없음', '반송 · 수신 거부 주소' in seen.get('sec', '') and seen.get('fb') == 'on' and not errs, f'{seen} · {errs[:2]}')
    finally:
        if sw0 is not None and not sw0.startswith('!'): psql(f"UPDATE site_settings SET value = '{sw0}' WHERE key = 'notify.ses_feedback'")
        if tp0 is not None and not tp0.startswith('!'):
            psql("UPDATE site_settings SET value = NULL WHERE key = 'notify.ses_topic_arn'" if not tp0 else f"UPDATE site_settings SET value = '{tp0}' WHERE key = 'notify.ses_topic_arn'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
