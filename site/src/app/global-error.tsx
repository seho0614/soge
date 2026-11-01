'use client';

/**
 * v10.174 (docs/268) — 맨 바깥 틀(layout)까지 그리지 못한 오류. 틀 · 사전 · 글꼴이 없으므로 두 언어 문장을 그대로 씁니다.
 *   (화면 하나의 오류는 app/error.tsx 가 받습니다 — 여기는 드문 경우)
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#fff', color: '#1a1a1a' }}>
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 16px' }} data-global-error="">
          <h1 style={{ fontSize: 22, color: '#00245a' }}>잠시 문제가 생겼습니다</h1>
          <p>화면을 여는 중에 오류가 났습니다. 잠시 뒤 다시 시도해 주십시오.</p>
          <p style={{ color: '#555' }}>Something went wrong. Please try again shortly.</p>
          <p>
            <button type="button" onClick={() => reset()} style={{ padding: '8px 16px', marginRight: 8 }}>다시 시도 · Try again</button>
            <a href="/" style={{ color: '#00245a' }}>처음으로 · Home</a>
          </p>
          {error.digest && <p style={{ color: '#888', fontSize: 13 }}>오류 번호 · Error ID {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
