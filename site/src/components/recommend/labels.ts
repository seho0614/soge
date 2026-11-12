/**
 * v10.254 (docs/388) — RcmTree 에 넘길 글자(서버 화면에서 사전 affiliate.recommend 로 만듦).
 *   {n} · {d} 는 브라우저 부품이 채움 — 영어 복수형(ICU)은 여기서 {n} 을 넣어 「other」 모양으로 풀어 둠.
 */
import type { RcmLabels } from './RcmTree';

type T = (key: string, values?: Record<string, string | number>) => string;

export function rcmLabels(t: T): RcmLabels {
  return {
    graph: t('graph'), list: t('list'), expandAll: t('expandAll'), collapseAll: t('collapseAll'), search: t('search'),
    zoomIn: t('zoomIn'), zoomOut: t('zoomOut'), fit: t('fit'), me: t('me'), left: t('left'), noMatch: t('noMatch'),
    joinedDay: t('joinedDay', { d: '{d}' }), joinedMonth: t('joinedMonth', { d: '{d}' }), theirs: t('theirs', { n: '{n}' }), found: t('found', { n: '{n}' }),
    rGot: t('rGot', { p: '{p}' }), rWait: t('rWait'), rNone: t('rNone'),
  };
}
