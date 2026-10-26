/**
 * v10.27 (G-130) — 사기 예방 가이드(SB-MNY-SAF-020) 글. 시안(사고예방 · 사기 예방 가이드)과 같은 글입니다.
 * 운영이 고칠 일이 생기면 콘텐츠(DB)로 옮깁니다 — 지금은 글이 정해져 있어 화면과 함께 둡니다.
 * v10.119 — 글은 사전(messages/<언어>/safety.json)으로 옮겼습니다. 여기는 순서 · 갈래 코드 · 그림 글자만. 서버 화면에서만 부릅니다.
 */
import { getTranslations } from 'next-intl/server';

export type SafetyKind = 'c1' | 'c2' | 'c3' | 'c4' | 'c5';

const KINDS: { code: SafetyKind; icon: string }[] = [
  { code: 'c1', icon: '🤝' }, { code: 'c2', icon: '💰' }, { code: 'c3', icon: '🚚' }, { code: 'c4', icon: '🪪' }, { code: 'c5', icon: '❗' },
];
const PLATFORM_ICONS = ['🔒', '🧾', '⚖', '📄'];

type Guide = { name: string; sub: string; how: Record<string, string>; stop: Record<string, string> };
type Hd = { h: string; d: string };

/** 화면 언어의 안전 수칙 · 사기 유형 · 플랫폼 장치 · 신고 절차 — 전과 같은 모양(SAFETY_RULES · SAFETY_GUIDES · SAFETY_PLATFORM · SAFETY_REPORT) */
export async function getSafety() {
  const t = await getTranslations('safety');
  const raw = t.raw as (k: string) => unknown;
  const guides = raw('guides') as Record<SafetyKind, Guide>;
  return {
    SAFETY_RULES: Object.values(raw('rules') as Record<string, string>),
    SAFETY_GUIDES: KINDS.map(({ code, icon }) => ({
      code, icon, name: guides[code].name, sub: guides[code].sub,
      how: Object.values(guides[code].how), stop: Object.values(guides[code].stop),
    })),
    SAFETY_PLATFORM: Object.values(raw('platform') as Record<string, Hd>)
      .map((x, i) => [PLATFORM_ICONS[i] ?? '•', x.h, x.d] as [string, string, string]),
    SAFETY_REPORT: Object.values(raw('report') as Record<string, Hd>).map((x) => [x.h, x.d] as [string, string]),
  };
}
