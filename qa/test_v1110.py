"""v10.110 시험 — AI 상담 손님 화면(사이트 공통 단추 · 대화 창 · docs/171)

  코드만:  KIT=… python3 -I test_v1110.py
  화면까지(점검판 · API 를 MOCK 으로):  시험 이미지 sgb-qa:v1 안에서
    docker run --rm --network host -v $PWD:/w -v $KIT:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1110.py

  ① 코드 — 공통 묶음 aiChat(ko · en 같은 열쇠) · 레이아웃에 단추 · 꺼짐이면 안 그림 · 파트너센터 제외 · 고지 · 넘기기 · 디자인 시트 값 · 화면 글자는 사전에
  ② (화면) 꺼짐 → 단추 없음 · 켬 → 단추 · 창 · 고지 · 묻기 · 답 · 남은 횟수 · 넘기기 → 접수 · 휴대폰 폭 · 영어 · Esc 닫기 · 끝나면 되돌림
"""
import json, os, re, subprocess

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
OUT = os.environ.get('SGB_QA_OUT', 'out')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


C = rd('site/src/components/common/AiChat.tsx'); L = rd('site/src/app/layout.tsx'); CSS = rd('site/src/styles/ai-chat.css')
ko = json.loads(rd('site/src/i18n/messages/ko/aiChat.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/aiChat.json') or '{}')
ok('① 사전 aiChat — 한국어 · 영어 열쇠가 같음 · 공통 묶음(SHARED)', ko and set(ko) == set(en) and 'aiChat };' in rd('site/src/i18n/messages/index.ts'), f'{len(ko)} · {len(en)}')
ok('① 고지 — 「AI 상담 · 정확하지 않을 수 있음 · 5년 보관」(닫기 없음)', '정확하지 않을 수 있습니다' in ko.get('notice', '') and '5년' in ko.get('notice', '') and 'data-ai-notice' in C, ko.get('notice', ''))
ok('① 레이아웃에 단추 · 꺼짐이면 그리지 않음 · 파트너센터 제외 · 꺼짐 1분 기억', '<AiChat />' in L and "import '@/styles/ai-chat.css'" in L and 'if (hidden || !enabled) return null;' in C
   and "const HIDE = ['/partner'];" in C and 'OFF_KEY' in C, '')
ok('① 묻기 · 넘기기 · 방문자 쿠키 · 새 상담 · Esc(창 안에서만) · 한글 입력 중 Enter 무시(229) · 남은 번호 지움 · 근거 링크는 사이트 안만 · 닫으면 단추로', 'staleConv' in C and 'keyCode !== 229' in C and 'const internal' in C and 'fabRef.current?.focus()' in C and "'/agent/chat'" in C and '/agent/chat/${conv}/handoff' in C and 'sgb_visitor' in C
   and 'reset' in C and "e.key === 'Escape'" in C and 'isComposing' in C, '')
ok('① 화면 글자는 사전에 — 부품 코드(주석 밖)에 한글 없음', not re.search(r'[가-힣]', re.sub(r'/\*[\s\S]*?\*/|//[^\n]*|\{/\*[\s\S]*?\*/\}', '', C)), '')
ok('① 디자인 시트 값 — 색 · 모서리 · 그림자 · 글꼴은 var(--sgb-…) · 겹침 피하기(광고 카드 · 상세 아래 띠) · 휴대폰 아래 시트',
   'var(--sgb-action)' in CSS and 'var(--sgb-shadow)' in CSS and 'var(--sgb-r-lg)' in CSS and 'var(--sgb-font-body)' in CSS
   and not re.search(r'box-shadow:\s*\d', CSS) and 'body:has(.gw-adfloat)' in CSS and 'body:has(.detail-side)' in CSS and '@media (max-width: 600px)' in CSS, '')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if SITE and DB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if not sync_playwright:
        ok('② 화면 시험은 시험 이미지(sgb-qa:v1 · playwright)에서', False, 'playwright 없음')
    else:
        KEYS = ['agent.enabled', 'agent.chat.enabled', 'agent.monthly_cap_usd', 'i18n.enabled']
        before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
        en_before = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
        mark = psql("SELECT coalesce(max(id), 0) FROM ops_alerts")
        os.makedirs(OUT, exist_ok=True)
        Sx = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                Sx('agent.chat.enabled', 'off')
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
                pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                ok('② 꺼짐 — 단추 없음', pg.locator('[data-ai-fab]').count() == 0, '')
                ctx.close()

                for k, v in (('agent.enabled', 'on'), ('agent.chat.enabled', 'on'), ('agent.monthly_cap_usd', '5')): Sx(k, v)
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
                pg.goto(SITE + '/', wait_until='networkidle', timeout=120000)
                fab = pg.locator('[data-ai-fab]')
                fab.wait_for(timeout=20000)
                ok('② 켬 — 단추 「AI 상담」', fab.is_visible() and 'AI 상담' in fab.inner_text(), fab.inner_text())
                fab.click()
                panel = pg.locator('[data-ai-panel]'); panel.wait_for(timeout=5000)
                notice = pg.locator('[data-ai-notice]').inner_text()
                ok('② 창 — 고지 첫 줄 · 질문 칸에 커서', '정확하지 않을 수 있습니다' in notice and pg.evaluate("document.activeElement && document.activeElement.tagName") == 'TEXTAREA', notice[:60])
                pg.locator('.ai-ask textarea').fill('소개비는 언제 받나요?')
                pg.locator('.ai-ask .ai-send').click()
                pg.locator('.ai-msg.ai p', has_text='[시험 엔진]').wait_for(timeout=20000)
                ok('② 묻기 → 답 · 내 질문 · 남은 횟수', pg.locator('.ai-msg.user').count() == 1 and '남은 횟수' in pg.locator('.ai-ask small').inner_text(), pg.locator('.ai-ask small').inner_text())
                pg.screenshot(path=f'{OUT}/v1110_desktop.png')
                pg.locator('[data-ai-handoff]').click()
                pg.locator('.ai-form input[type=email]').fill('ui1110@example.com')
                pg.locator('.ai-form .ai-send').click()
                pg.locator('[data-ai-done]').wait_for(timeout=15000)
                ok('② 넘기기 → 접수 안내 · 1:1 문의 생김', '접수' in pg.locator('[data-ai-done]').inner_text()
                   and psql("SELECT count(*) FROM inquiries WHERE email = 'ui1110@example.com' AND channel = 'BOT'") == '1', pg.locator('[data-ai-done]').inner_text())
                # (검토 반영) 끝났거나 내 것이 아닌 상담 번호가 남아 있으면 — 오류 뒤 번호를 지우고 글을 되살림 → 다시 보내면 새 상담
                pg.evaluate("sessionStorage.setItem('sgb_ai_chat_conv', '00000000-0000-4000-a000-000000000000')")
                pg.reload(wait_until='networkidle'); pg.locator('[data-ai-fab]').wait_for(timeout=20000); pg.locator('[data-ai-fab]').click()
                pg.locator('.ai-ask textarea').fill('남은 번호 시험'); pg.locator('.ai-ask .ai-send').click()
                pg.locator('.ai-err').wait_for(timeout=15000)
                kept = pg.locator('.ai-ask textarea').input_value(); left = pg.evaluate("sessionStorage.getItem('sgb_ai_chat_conv')")
                pg.locator('.ai-ask .ai-send').click(); pg.locator('.ai-msg.ai p', has_text='[시험 엔진]').wait_for(timeout=20000)
                ok('② (검토 반영) 남은 상담 번호 — 오류 뒤 번호 지움 · 쓴 글 되살림 · 다시 보내면 새 상담', kept == '남은 번호 시험' and left is None, f'{kept} · {left}')
                pg.locator('.ai-ask textarea').focus(); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
                ok('② Esc(창 안에서) → 창 닫힘 · 단추로 돌아감', pg.locator('[data-ai-panel]').count() == 0 and pg.locator('[data-ai-fab]').count() == 1
                   and pg.evaluate("document.activeElement && document.activeElement.hasAttribute('data-ai-fab')"), '')
                ctx.close()

                ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); pg = ctx.new_page()
                pg.goto(SITE + '/', wait_until='networkidle', timeout=120000)
                pg.locator('[data-ai-fab]').wait_for(timeout=20000); pg.locator('[data-ai-fab]').click()
                box = pg.locator('[data-ai-panel]').bounding_box()
                ok('② 휴대폰 폭 — 창이 화면 폭 전체 · 아래에 붙음', box and abs(box['width'] - 390) <= 2 and abs(box['y'] + box['height'] - 844) <= 2, str(box))
                pg.screenshot(path=f'{OUT}/v1110_mobile.png')
                ctx.close()

                Sx('i18n.enabled', 'on'); psql("UPDATE i18n_langs SET is_active = true WHERE code = 'en';")
                subprocess.run(['sleep', '65'])   # 사용자 웹의 언어 목록 기억(60초)
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}); ctx.add_cookies([{'name': 'sgb_lang', 'value': 'en', 'url': SITE}]); pg = ctx.new_page()
                pg.goto(SITE + '/', wait_until='networkidle', timeout=120000)
                pg.locator('[data-ai-fab]').wait_for(timeout=20000)
                ok('② 영어 화면 — 단추 「AI help」', 'AI help' in pg.locator('[data-ai-fab]').inner_text(), pg.locator('[data-ai-fab]').inner_text())
                ctx.close(); b.close()
        finally:
            psql("DELETE FROM agent_conversations WHERE channel = 'SITE_CHAT' AND created_at > now() - interval '1 hour';")
            psql("DELETE FROM inquiries WHERE email = 'ui1110@example.com';")
            psql("DELETE FROM agent_usage_daily WHERE channel = 'SITE_CHAT'; DELETE FROM agent_chat_usage WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date;")
            psql(f"DELETE FROM ops_alerts WHERE id > {mark or 0} AND alert_code = 'AGENT_CHAT_HANDOFF';")
            for k, v in before.items(): psql(f"UPDATE site_settings SET value = $v${v}$v$ WHERE key = '{k}';")
            psql(f"UPDATE i18n_langs SET is_active = {'true' if en_before == 't' else 'false'} WHERE code = 'en';")
            ok('② 끝나면 되돌림 — 상담 · 문의 · 사용량 · 경보 · 스위치 · 언어', psql("SELECT count(*) FROM inquiries WHERE email = 'ui1110@example.com'") == '0'
               and all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.110 이상', _v >= (10, 110), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
