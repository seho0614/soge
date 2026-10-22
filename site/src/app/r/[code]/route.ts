import { NextResponse, type NextRequest } from 'next/server';

/**
 * 제휴 링크 공유 주소 — /r/{code}  (D001 · 2026-10-02)
 *
 * 파트너가 블로그·카톡에 뿌리는 주소입니다. 누르면
 *   ① API GET /r/{code} 가 클릭을 **하루·방문자당 한 번** 세고 착지 주소를 돌려주고
 *   ② 여기서 302 로 보냅니다.
 *
 * ★ 열린 리다이렉트 차단 — 착지 주소는 http/https 절대주소나 우리 사이트 내부 경로(/…)만.
 *   javascript: · data: · //남의도메인 은 API·DB(fn_aff_safe_landing)가 막고, 여기서도 한 번 더 봅니다.
 * ★ 방문자는 sgb_visitor 쿠키로 구분합니다(없으면 만들어 둡니다 — 가입·로그인 때 유입을 잇는 그 쿠키).
 *   서버에서 API 를 부르므로 이용자의 브라우저 정보(UA·IP)를 헤더로 넘겨야 로봇을 거를 수 있습니다.
 *   API 는 이것을 **해시로만** 남깁니다.
 */
export const dynamic = 'force-dynamic';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const VISITOR_COOKIE = 'sgb_visitor';

/** 이동해도 되는 주소인가 — 되면 Location 값(내부 경로는 그대로, 외부는 정규화한 절대 URL), 아니면 null */
function safeTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300 || /\s/.test(raw)) return null;
  /* 내부 경로 — 도메인을 붙이지 않고 상대 Location 으로 둡니다(프록시 뒤에서도 우리 도메인 유지) */
  if (/^\/(?![/\\])/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && !u.username && !u.password) {
      return u.toString();
    }
  } catch { /* 주소가 아님 */ }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 안 열리는 링크 — 친절한 404. 사이트 레이아웃 밖이라 스타일을 여기 둡니다. */
function unavailable(message: string, status = 404) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>링크를 열 수 없습니다 — 소개뱅크</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--dim:#5b6475;--pri:#1f5eff}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--fg:#e8ebf1;--dim:#a2abbb;--pri:#6f97ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:440px;margin:12vh auto;padding:32px 24px;background:var(--card);border-radius:16px;box-shadow:4px 4px 8px rgba(0,0,0,.04);text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:var(--dim);margin:0 0 20px}
a{display:inline-block;padding:10px 18px;border-radius:7px;background:var(--pri);color:#fff;text-decoration:none;font-weight:600}
</style></head><body><main data-testid="aff-link-unavailable">
<h1>링크를 열 수 없습니다</h1><p>${esc(message)}</p><a href="/">소개뱅크 홈으로</a>
</main></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;

  let visitor = req.cookies.get(VISITOR_COOKIE)?.value;
  const fresh = !visitor || !/^[A-Za-z0-9-]{8,64}$/.test(visitor);
  if (fresh) visitor = crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`${BASE}/r/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: {
        'X-Visitor-Key': visitor!,
        'User-Agent': req.headers.get('user-agent') ?? '',
        'X-Forwarded-For': req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
      },
    });
  } catch {
    return unavailable('잠시 연결이 원활하지 않습니다. 조금 뒤 다시 눌러 주십시오.', 503);
  }
  const body = (await res.json().catch(() => null)) as { landingUrl?: string; message?: string } | null;
  if (!res.ok) return unavailable(body?.message ?? '없거나 사용이 끝난 링크입니다.', res.status === 404 ? 404 : 503);

  const target = safeTarget(body?.landingUrl);
  if (!target) return unavailable('이동할 주소가 올바르지 않아 열지 않았습니다.');

  const out = new NextResponse(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
  out.headers.set('referrer-policy', 'no-referrer-when-downgrade');
  if (fresh) {
    out.cookies.set(VISITOR_COOKIE, visitor!, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  return out;
}
