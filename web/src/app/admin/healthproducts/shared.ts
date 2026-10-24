

export const ST: Record<string, string> = { DRAFT: '초안', ON_SALE: '판매 중', SOLD_OUT: '품절', STOPPED: '판매 중지' };

export interface Cat { code: string; name: string; state: string; note: string | null; onSale: number; total: number; noticeGroup: string | null; commissionRate: string | null }

export interface Ing { code: string; name: string; aliases: string[] | null; isGroup: boolean; parent: string | null; featured: boolean; excipient: boolean; onSale: number }
