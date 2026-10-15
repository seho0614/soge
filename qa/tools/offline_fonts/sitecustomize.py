"""시험 환경용 덧붙임 — 바깥 인터넷이 막힌 곳에서만 씁니다. (v10.30)

v10.29 부터 사용자 웹이 본문 글꼴(Noto Sans KR)을 구글 글꼴 서버에서 받습니다(site/src/app/layout.tsx).
인터넷이 막힌 시험 환경에서는 그 요청이 실패해 **화면마다 브라우저 오류가 1건씩** 나고(net::ERR_TUNNEL_CONNECTION_FAILED 등),
「콘솔 오류 0」을 보는 옛 시험이 그 한 줄 때문에 실패로 셉니다 — 화면의 잘못이 아닙니다(인터넷이 되는 PC 에서는 나지 않습니다).

이 파일은 Playwright 가 여는 브라우저마다 **구글 글꼴 주소(fonts.googleapis.com · fonts.gstatic.com)에만** 빈 응답(200)을 돌려주게 합니다.
다른 주소는 건드리지 않습니다. 글꼴은 적용되지 않으므로(빈 CSS) 화면은 인터넷이 막힌 때와 같은 모양입니다.

  쓰는 법:  PYTHONPATH=qa/tools/offline_fonts python3 qa/<시험>.py
  끄기:     SGB_OFFLINE_FONTS=0  (또는 PYTHONPATH 를 주지 않음)
"""
import os, re
if os.environ.get('SGB_OFFLINE_FONTS', '1') == '1':
    _PAT = re.compile(r'^https://fonts\.(googleapis|gstatic)\.com/')
    def _sync_handler(route):
        try: route.fulfill(status=200, content_type='text/css; charset=utf-8', body='/* offline_fonts — 시험 환경의 빈 응답 */')
        except Exception: pass
    async def _async_handler(route):
        try: await route.fulfill(status=200, content_type='text/css; charset=utf-8', body='/* offline_fonts — 시험 환경의 빈 응답 */')
        except Exception: pass
    try:
        from playwright.sync_api import Browser as _SB, BrowserType as _SBT
        _s_new_context = _SB.new_context; _s_new_page = _SB.new_page; _s_persist = _SBT.launch_persistent_context
        def _nc(self, *a, **k):
            c = _s_new_context(self, *a, **k); c.route(_PAT, _sync_handler); return c
        def _np(self, *a, **k):
            p = _s_new_page(self, *a, **k); p.context.route(_PAT, _sync_handler); return p
        def _pc(self, *a, **k):
            c = _s_persist(self, *a, **k); c.route(_PAT, _sync_handler); return c
        _SB.new_context = _nc; _SB.new_page = _np; _SBT.launch_persistent_context = _pc
    except Exception: pass
    try:
        from playwright.async_api import Browser as _AB, BrowserType as _ABT
        _a_new_context = _AB.new_context; _a_new_page = _AB.new_page; _a_persist = _ABT.launch_persistent_context
        async def _anc(self, *a, **k):
            c = await _a_new_context(self, *a, **k); await c.route(_PAT, _async_handler); return c
        async def _anp(self, *a, **k):
            p = await _a_new_page(self, *a, **k); await p.context.route(_PAT, _async_handler); return p
        async def _apc(self, *a, **k):
            c = await _a_persist(self, *a, **k); await c.route(_PAT, _async_handler); return c
        _AB.new_context = _anc; _AB.new_page = _anp; _ABT.launch_persistent_context = _apc
    except Exception: pass
