import { ApiFailure } from '../lib/api';

/** 403 게이트별 유도 경로. 프런트가 역할·게이트를 재계산하지 않습니다. */
const GATE_ROUTE: Record<string, { to: string; cta: string }> = {
  IDENTITY_REQUIRED:     { to: '/verify',      cta: '본인인증 하기' },
  SUBSCRIPTION_REQUIRED: { to: '/my/subscription/upgrade', cta: '구독 알아보기' },
  UNAUTHENTICATED:       { to: '/login',       cta: '로그인' },
};

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!(error instanceof ApiFailure)) {
    return <Box tone="danger">처리 중 오류가 발생했습니다.</Box>;
  }

  const gate = GATE_ROUTE[error.body.code];
  if (error.isGate && gate) {
    return (
      <Box tone="info">
        <p style={{ margin: 0 }}>{error.body.message}</p>
        <a href={gate.to} style={{ color: 'var(--accent)', fontWeight: 700 }}>{gate.cta} →</a>
      </Box>
    );
  }

  // 409 는 재시도해도 같은 결과입니다. 다시 부르는 버튼을 주지 않습니다.
  if (error.isConflict) {
    return (
      <Box tone="warning">
        <p style={{ margin: 0 }}>{error.body.message}</p>
        <button onClick={() => location.reload()} style={btn}>다시 불러오기</button>
      </Box>
    );
  }

  // 422 는 message 를 그대로 보여 줍니다 — 사용자에게 보여도 되는 문장입니다.
  return (
    <Box tone="danger">
      <p style={{ margin: 0 }}>{error.body.message}</p>
      {onRetry && !error.isPolicy && <button onClick={onRetry} style={btn}>다시 시도</button>}
    </Box>
  );
}

const btn: React.CSSProperties = {
  marginTop: 'var(--sp-2)', padding: '6px 12px', fontSize: 'var(--fs-sm)',
  border: '1px solid var(--line)', background: 'var(--paper)',
  borderRadius: 'var(--r-sm)', cursor: 'pointer',
};

function Box({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 'var(--sp-4)', borderRadius: 'var(--r-md)',
      border: `1px solid var(--tone-${tone})`, color: `var(--tone-${tone})`,
      display: 'grid', gap: 'var(--sp-2)', justifyItems: 'start',
    }}>{children}</div>
  );
}
