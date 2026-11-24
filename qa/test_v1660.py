"""v10.660 ~ 667 (D314 · D315 · docs/795) 준비중 관 지우기 · 관 아이콘 · 대표 색 · 관 페이지 예약 게시 · 번역 초안 · 동영상 · 방문 수 · 틀 · 미리보기 링크
  ① (코드) D314 · D315 · 서버(deleteGwan · icon · color · publishDue · schedule · translate · previews · views · VIDEO) · 운영 화면 · 사용자 웹 · 영어 · screens.json
  ② (DB) 처음 관 지우기 막힘(GWAN_DELETE) · 처음 관에 소개 대상 넣기 막힘 · 게시 판 지우기 막힘(관 지우기 밖) · 아이콘 · 색 이름 CHECK — 모두 되돌림
  ③ (API) 새 준비중 관 — 아이콘 · 색 · 소개 대상 바꿈 · 틀린 아이콘 400 · MNY 시험 페이지 — 동영상 블록(유튜브 아닌 주소 422) · 예약(5분 안 422 · 시각 지난 예약은 목록을 읽을 때 게시)
       · 미리보기 링크(공개 200 → 끊기 404) · 방문 한 번(같은 기기 두 번째는 안 셈) · 번역 초안(MOCK 이면 채움 · AI 꺼짐이면 422 AGENT_OFF)
       · 관 지우기(확인 글자 틀림 422 · 맞으면 지움 · 페이지 · 폼 문구 함께) · 처음 관 지우기 422 — 끝나면 시험 페이지 · 계정 지움
  ④ 문서 795 · 판
  (두 번 돌아도 통과 — 관 코드 · 주소에 시각을 붙임)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def call(m_, p, b=None, t=None, hd0=None):
    hd = {'content-type': 'application/json', **(hd0 or {})}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()

# v10.705 (docs/813) 관이 열려 있으면 관 페이지를 만들거나 고칠 수 없음 → 고치는 부르기만 소개장터(MNY)를 잠깐 닫았다 다시 엶(이 시험은 늘 혼자 · reg_solo_force)
_call_open = call


def call(m_, p, b=None, t=None, hd0=None):
    if m_ != 'GET' and re.match(r'^/admin/(gwan-pages|gwans/MNY/pages|gwan-fragments/\d+/republish)', p):
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")
        try:
            return _call_open(m_, p, b, t, hd0)
        finally:
            psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
    return _call_open(m_, p, b, t, hd0)



def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def _up():   # 서버 · DB 가 응답할 때만 ② · ③(미리 검사는 닿지 않는 주소로 돎)
    try:
        urllib.request.urlopen(API + '/health', timeout=5); api = True
    except Exception:
        api = False
    return api, bool(DB) and psql('SELECT 1') == '1'


API_UP, DB_UP = _up() if API and DB else (False, False)
VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

# ── ① 코드 ─────────────────────────────────────────────────────────────
M4 = rd('prisma/migrations/D314_gwan_delete_icon/migration.sql')
M5 = rd('prisma/migrations/D315_gwan_page_schedule_preview_views/migration.sql')
M311 = rd('prisma/migrations/D311_gwan_pages/migration.sql')
NO_DEL = lambda s: not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', s, re.I) and not re.search(r"RAISE EXCEPTION '[^']*%", s)
ok('① D314 — 아이콘 · 색 CHECK · fn_gwan_draft_guard(지우기 · 소개 대상) · fn_gwan_page_ver_ro 는 D311 글 그대로 + 관 지우기 줄 · 권한 주소 · 지우는 문장 없음',
   'gwans_icon_check' in M4 and 'gwans_color_check' in M4 and 'fn_gwan_draft_guard' in M4 and 'BEFORE UPDATE OR DELETE ON public.gwans' in M4
   and "current_setting('app.gwan_delete', true)" in M4 and 'GWAN_PAGE_VERSION_RO: 게시된 판은 고치거나 지울 수 없습니다 — 새 판을 게시하십시오.' in M4 and 'GWAN_PAGE_VERSION_RO: 게시된 판은 고치거나 지울 수 없습니다 — 새 판을 게시하십시오.' in M311
   and "('DELETE', '/admin/gwans/{code}', 'gwans', 'EDIT')" in M4 and 'OLD.intro_target IS NULL OR NEW.intro_target IS NULL' in M4 and NO_DEL(M4), str(len(M4)))
ok('① D315 — 예약 칸 4 · CHECK · 미리보기 표(40자 · 72시간) · 방문 표 · CASCADE · 권한 주소 6 · 지우는 문장 없음',
   all(c in M5 for c in ('scheduled_at timestamptz', 'scheduled_by uuid', 'scheduled_title text', 'scheduled_blocks jsonb', 'gwan_pages_schedule_check',
                         'gwan_page_previews', "token ~ '^[0-9a-f]{40}$'", "interval '72 hours'", 'gwan_page_views', 'ON DELETE CASCADE'))
   and M5.count("'/admin/gwan-pages/{id}/") == 6 and NO_DEL(M5), str(len(M5)))
SS, SD, SC = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.dto.ts'), rd('src/modules/site/site.controller.ts')
GS, GC = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts')
ok('① 서버 — 관 지우기(확인 글자 · 쓰는 곳 셈 · 한 거래 · app.gwan_delete) · 아이콘 · 색 · 소개 대상 · 공개 /gwans 아이콘 · 색',
   'async deleteGwan(code: string, confirm: string)' in SS and "set_config('app.gwan_delete', 'on', true)" in SS and 'GWAN_IN_USE' in SS and 'GWAN_DELETE_CONFIRM' in SS
   and 'GWAN_ICONS' in SD and 'GWAN_COLORS' in SD and 'introTarget?: string' in SD and "@Delete('gwans/:code')" in SC and "remove(@Param('code')" in SC
   and 'g.icon, g.color' in rd('src/modules/catalog/catalog.service.ts'), '')
ok('① 서버 — 예약(publishDue · SKIP LOCKED · 뜬 내용) · 번역 초안(TRANSLATE · 요금표) · 미리보기 · 방문 수 · VIDEO(youtubeId)',
   'async publishDue(' in GS and 'FOR UPDATE SKIP LOCKED' in GS and 'scheduled_blocks' in GS and "this.agent.allowed('TRANSLATE')" in GS and 'agent_model_prices' in GS
   and 'async createPreview(' in GS and 'async previewPage(' in GS and 'async recordView(' in GS and 'async viewStats(' in GS and "case 'VIDEO'" in GS and 'export function youtubeId(' in GS
   and "@Post('admin/gwan-pages/:id/schedule')" in GC and "@Get('gwan-pages/preview/:token')" in GC and "@Post('gwans/:code/pages/:slug/view')" in GC
   and GC.index('class GwanPagePublicDto') < GC.index('class GwanPagePreviewPublicDto'), '')
GP, GSet, SH = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/gwans/shared.ts')
ok('① 운영 화면 — 관 설정(아이콘 · 색 · 소개 대상 · 「이 관 지우기」) · 관 페이지(예약 · 번역 초안 · 동영상 · 틀 3 · 미리보기 링크 · 방문 수 · 7일 방문 열)',
   'data-gwan-icon' in GSet and 'data-gwan-color' in GSet and 'data-gwan-target' in GSet and 'function DeleteGwan(' in GSet and 'deletable?: boolean' in SH
   and 'function Schedule(' in GP and 'data-gwan-page-ai' in GP and "['VIDEO', '동영상(유튜브)']" in GP and GP.count("{ key: '") >= 3 and 'data-gwan-page-templates' in GP
   and 'function PreviewLinks(' in GP and 'function Views(' in GP and '7일 방문' in GP, '')
SB, SG = rd('site/src/components/gwan/GwanBlocks.tsx'), rd('site/src/app/[gwan]/page.tsx')
ok('① 사용자 웹 — 아이콘 · 색(GwanLook) · 동영상(youtube-nocookie · CSP) · 미리보기(noindex · robots) · 방문 보내기(첫 화면 · 관 안 페이지)',
   'export function GwanIcon(' in rd('site/src/components/gwan/GwanLook.tsx') and 'gwanHeadStyle(g?.color)' in SG and 'GwanIcon' in rd('site/src/components/home/Sections.tsx')
   and 'youtube-nocookie.com/embed/' in SB and 'https://www.youtube-nocookie.com' in rd('site/next.config.js')
   and "robots: { index: false, follow: false }" in rd('site/src/app/preview/page/[token]/page.tsx') and "'/preview/'" in rd('site/src/app/robots.ts')
   and 'ViewPing' in SG and 'ViewPing' in rd('site/src/app/[gwan]/info/[slug]/page.tsx'), '')
EN, SJ = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json')
ok('① 영어 16 · screens.json(새 화면 SB-HOM-GWN-030 · 새 주소 8)',
   sum(k in EN for k in ('확인 글자에 관 코드를 그대로 넣으십시오.', '예약 시각은 5분 뒤부터 90일 안이어야 합니다.', '미리보기 링크가 없거나 끝났습니다.', '아이콘 이름이 목록에 없습니다.', '한국어판이 없습니다.')) == 5
   and '"SB-HOM-GWN-030"' in SJ and all(a in SJ for a in ('DELETE /admin/gwans/{code}', 'POST /admin/gwan-pages/{id}/schedule', 'POST /admin/gwan-pages/{id}/translate',
       'POST /admin/gwan-pages/{id}/previews', 'DELETE /admin/gwan-pages/{id}/previews/{token}', 'GET /admin/gwan-pages/{id}/views', 'GET /gwan-pages/preview/{token}', 'POST /gwans/{code}/pages/{slug}/view')), '')

# ── ② DB ───────────────────────────────────────────────────────────────
if DB and DB_UP:
    d1 = psql("BEGIN; DELETE FROM gwans WHERE code = 'MNY'; ROLLBACK;")
    d2 = psql("BEGIN; UPDATE gwans SET intro_target = 'GOODS' WHERE code = 'MAL'; ROLLBACK;")
    d3 = psql("BEGIN; INSERT INTO gwans (code, name, is_active, sort_order, icon) VALUES ('ZZQX', 'x', false, 999, 'rocket'); ROLLBACK;")
    d4 = psql("BEGIN; INSERT INTO gwans (code, name, is_active, sort_order, color) VALUES ('ZZQX', 'x', false, 999, '#ff0000'); ROLLBACK;")
    d5 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title) VALUES ('MNY', 'zz-ro-1660', 'x'); "
              "INSERT INTO gwan_page_versions (page_id, version, title, blocks) SELECT id, 1, 'x', '[]'::jsonb FROM gwan_pages WHERE slug = 'zz-ro-1660'; "
              "DELETE FROM gwan_page_versions WHERE page_id = (SELECT id FROM gwan_pages WHERE slug = 'zz-ro-1660'); ROLLBACK;")
    ok('② DB — 처음 관 지우기 GWAN_DELETE · 처음 관 소개 대상 GWAN_INTRO_TARGET · 아이콘 · 색 CHECK · 판 지우기 GWAN_PAGE_VERSION_RO(관 지우기 밖)',
       'GWAN_DELETE' in d1 and 'GWAN_INTRO_TARGET' in d2 and 'gwans_icon_check' in d3 and 'gwans_color_check' in d4 and 'GWAN_PAGE_VERSION_RO' in d5, ' | '.join(x[-60:] for x in (d1, d2, d3, d4, d5)))

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    code = 'Z' + ''.join(chr(65 + int(c)) for c in stamp[-3:])   # Z + 글자 3 = 4자
    slug, em = f'zv{stamp}', f't1660a{stamp}@x.com'
    pid = None
    try:
        h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1660', '{h}', now()) ON CONFLICT DO NOTHING")
        aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1660', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        import consent_ok
        consent_ok.agree(em, PW); consent_ok.agree('admin@x.com', PW)
        TA, TS_ = login(em), login('admin@x.com')
        psql(f"DELETE FROM gwan_form_copy WHERE gwan_code = '{code}'; DELETE FROM gwans WHERE code = '{code}' AND opened_at IS NULL AND NOT is_active")
        g0 = call('POST', '/admin/gwans', {'code': code, 'name': '시험관1660', 'description': '시험', 'introTarget': 'GOODS'}, TS_)
        p1 = call('PATCH', f'/admin/gwans/{code}', {'icon': 'book', 'color': 'mall', 'introTarget': 'ASSET'}, TS_)
        bad = call('PATCH', f'/admin/gwans/{code}', {'icon': 'rocket'}, TS_)
        g1 = call('GET', f'/admin/gwans/{code}', None, TS_)
        ok('③ 새 준비중 관 — 아이콘 book · 색 mall · 소개 대상 GOODS → ASSET · 틀린 아이콘 400 · 지울 수 있음 표시',
           g0.get('code') == code and g1.get('icon') == 'book' and g1.get('color') == 'mall' and g1.get('introTarget') == 'ASSET' and bad.get('_err') == 400 and g1.get('deletable') is True,
           f"{g0.get('code') or g0} · {g1.get('icon')} {g1.get('color')} {g1.get('introTarget')} · {bad.get('_err')} · {g1.get('deletable')}")
        # 관 페이지(소개장터 · 켠 관)
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 1660'}, TA)
        pid = pg.get('id')
        vbad = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'VIDEO', 'url': 'https://vimeo.com/123'}]}, TA)
        v1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'HERO', 'title': '안내', 'sub': '', 'image': '', 'button': None},
                                                                    {'type': 'VIDEO', 'url': 'https://youtu.be/dQw4w9WgXcQ', 'caption': '소개 영상'}]}, TA)
        vid = next((b for b in (v1.get('blocks') or []) if b.get('type') == 'VIDEO'), {})
        ok('③ 동영상 블록 — 유튜브 아닌 주소 422 · youtu.be 주소 → 영상 번호 11자',
           vbad.get('_err') == 422 and vid.get('videoId') == 'dQw4w9WgXcQ', f"{vbad.get('_err')} · {vid.get('videoId')}")
        # 예약
        s_ad = call('POST', f'/admin/gwan-pages/{pid}/schedule', {'at': '2099-01-01T00:00:00Z'}, TA)
        s_soon = call('POST', f'/admin/gwan-pages/{pid}/schedule', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 60))}, TS_)
        s_ok = call('POST', f'/admin/gwan-pages/{pid}/schedule', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))}, TS_)
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '예약 뒤 고친 초안'}]}, TA)   # 예약 내용은 그대로여야
        psql(f"UPDATE gwan_pages SET scheduled_at = now() - interval '1 minute' WHERE id = {int(pid or 0)}")
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")   # v10.705 예약 게시는 관이 닫혀 있을 때만(열려 있으면 기다림)
        rows = call('GET', '/admin/gwans/MNY/pages', None, TA)
        psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
        me = next((r for r in rows if isinstance(rows, list) and r.get('id') == pid), {}) if isinstance(rows, list) else {}
        pub = call('GET', f'/gwans/MNY/pages/{slug}')
        ok('③ 예약 — ADMIN 403 · 5분 안 422 · SUPER 예약 → 시각 지나면 목록 읽을 때 게시 · 예약할 때 뜬 블록(뒤에 고친 초안 아님)',
           s_ad.get('_err') == 403 and s_soon.get('_err') == 422 and s_ok.get('scheduledAt') and me.get('status') == 'PUBLISHED' and me.get('scheduledAt') is None
           and any(b.get('type') == 'VIDEO' for b in (pub.get('blocks') or [])),
           f"{s_ad.get('_err')} · {s_soon.get('_err')} · {bool(s_ok.get('scheduledAt'))} · {me.get('status')} · {[b.get('type') for b in (pub.get('blocks') or [])]}")
        # 미리보기 링크
        pv = call('POST', f'/admin/gwan-pages/{pid}/previews', {'hours': 1}, TA)
        tok = pv.get('token') or ''
        pr1 = call('GET', f'/gwan-pages/preview/{tok}')
        rv = call('DELETE', f'/admin/gwan-pages/{pid}/previews/{tok}', None, TA)
        pr2 = call('GET', f'/gwan-pages/preview/{tok}')
        ok('③ 미리보기 링크 — 40자 · 공개로 지금 초안(예약 뒤 고친 글) · 끊으면 404',
           len(tok) == 40 and pr1.get('preview') is True and any(b.get('body') == '예약 뒤 고친 초안' for b in (pr1.get('blocks') or [])) and rv.get('revoked') is True and pr2.get('_err') == 404,
           f"{len(tok)} · {pr1.get('preview')} · {rv.get('revoked')} · {pr2.get('_err')}")
        # 방문 수
        ua = {'user-agent': f'Mozilla/5.0 t1660-{stamp}'}
        w1 = call('POST', f'/gwans/MNY/pages/{slug}/view', None, None, ua)
        w2 = call('POST', f'/gwans/MNY/pages/{slug}/view', None, None, ua)
        wb = call('POST', f'/gwans/MNY/pages/{slug}/view', None, None, {'user-agent': 'Googlebot/2.1'})
        vs = call('GET', f'/admin/gwan-pages/{pid}/views?days=7', None, TA)
        ok('③ 방문 수 — 첫 번째 셈 · 같은 기기 두 번째 안 셈 · 로봇 안 셈 · 7일 합 1',
           w1.get('counted') is True and w2.get('counted') is False and wb.get('counted') is False and vs.get('total') == 1 and len(vs.get('rows') or []) == 7,
           f"{w1.get('counted')} {w2.get('counted')} {wb.get('counted')} · {vs.get('total')} · {len(vs.get('rows') or [])}")
        # 번역 초안 — 영어판이 있으면(언어 목록에 en)
        if psql("SELECT count(*) FROM i18n_langs WHERE code = 'en'") == '1':
            en = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': 'Test 1660', 'lang': 'en'}, TA)
            tr = call('POST', f"/admin/gwan-pages/{en.get('id')}/translate", None, TA)
            ko_tr = call('POST', f'/admin/gwan-pages/{pid}/translate', None, TA)
            ok('③ 번역 초안 — 한국어판에서 422 · 언어판은 채움(MOCK) 또는 AI 꺼짐 422 AGENT_OFF',
               ko_tr.get('code') == 'GWAN_PAGE_TRANSLATE' and ((tr.get('translatedFields') or 0) > 0 or tr.get('code') in ('AGENT_OFF', 'MODEL_UNPRICED')),
               f"{ko_tr.get('code')} · {tr.get('translatedFields') or tr.get('code')}")
        # 관 지우기 — 페이지 · 폼 문구를 붙인 뒤
        call('PUT', f'/admin/gwans/{code}/form-copy/OFFER', {'subject': '시험', 'titleHint': '시험', 'bodyHint': '시험'}, TS_)
        hp = call('POST', f'/admin/gwans/{code}/pages', {'slug': 'home', 'title': '첫 화면'}, TS_)
        call('PATCH', f"/admin/gwan-pages/{hp.get('id')}", {'blocks': [{'type': 'TEXT', 'body': '시험'}]}, TS_)
        call('POST', f"/admin/gwan-pages/{hp.get('id')}/publish", None, TS_)
        x_conf = call('DELETE', f'/admin/gwans/{code}', {'confirm': 'NOPE'}, TS_)
        x_adm = call('DELETE', f'/admin/gwans/{code}', {'confirm': code}, TA)
        x_ok = call('DELETE', f'/admin/gwans/{code}', {'confirm': code}, TS_)
        left = psql(f"SELECT (SELECT count(*) FROM gwans WHERE code = '{code}') + (SELECT count(*) FROM gwan_pages WHERE gwan_code = '{code}') + (SELECT count(*) FROM gwan_form_copy WHERE gwan_code = '{code}')")
        x_mny = call('DELETE', '/admin/gwans/MNY', {'confirm': 'MNY'}, TS_)
        ok('③ 관 지우기 — 확인 글자 틀림 422 · ADMIN 403 · SUPER 지움(게시 판 있는 첫 화면 · 폼 문구 함께 · 남은 것 0) · 처음 관 422 GWAN_DELETE',
           x_conf.get('code') == 'GWAN_DELETE_CONFIRM' and x_adm.get('_err') == 403 and x_ok.get('deleted') == code and left == '0' and x_mny.get('code') == 'GWAN_DELETE',
           f"{x_conf.get('code')} · {x_adm.get('_err')} · {x_ok.get('deleted') or x_ok} · {left} · {x_mny.get('code')}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}' OR gwan_code = '{code}'); "
             f"DELETE FROM gwan_pages WHERE slug = '{slug}' OR gwan_code = '{code}'; DELETE FROM gwan_form_copy WHERE gwan_code = '{code}'; DELETE FROM gwans WHERE code = '{code}';")
        psql(f"DELETE FROM ops_alerts WHERE alert_code LIKE 'GWAN_PAGE_%' AND (detail->>'slug' = '{slug}' OR detail->>'gwan' = '{code}')")   # v10.670 알림
        from qa_helpers import drop_accounts_sql   # 권한 그룹 줄까지(주인 없는 줄 남기지 않음)
        psql(drop_accounts_sql(f"email = '{em}'"))
        ok('③ 끝 — 시험 관 · 페이지 · 계정 지움', psql(f"SELECT (SELECT count(*) FROM gwans WHERE code = '{code}') + (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM accounts WHERE email = '{em}')") == '0', '')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d795 = doc('795_')
ok('④ 문서 795 — 지우기 · 아이콘 · 예약 · 번역 초안 · 동영상 · 방문 수 · 틀 · 미리보기 · D314 · D315',
   all(w in d795 for w in ('이 관 지우기', '대표 색', '예약 게시', '번역 초안', '동영상', '방문 수', '틀로 시작', '미리보기 링크', 'D314', 'D315')), str(len(d795)))
ok('④ VERSION v10.660 이상', VT >= (10, 660), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
