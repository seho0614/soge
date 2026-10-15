import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { codeLabel } from '../../generated/codes';

export interface CodeEntry {
  code: string; label: string; shortLabel: string | null;
  tone: string | null; sortOrder: number;
}

/**
 * 코드 라벨 제공.
 *
 * DB 가 정본이고, 생성 파일(codes.ts)은 컴파일 타임 타입 안전과 폴백 용도입니다.
 * 라벨을 바꾸려고 배포하는 일이 없어야 합니다.
 */
@Injectable()
export class CodeService implements OnModuleInit {
  private cache = new Map<string, CodeEntry[]>();
  private loadedAt = 0;
  private readonly TTL = 60_000;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() { await this.refresh(); }

  async refresh() {
    const rows = await this.db.query<{
      domain: string; code: string; label: string;
      short_label: string | null; ui_tone: string | null; sort_order: number;
    }>(`SELECT domain, code, label, short_label, ui_tone, sort_order
          FROM code_labels WHERE is_active ORDER BY domain, sort_order`);

    const next = new Map<string, CodeEntry[]>();
    for (const r of rows) {
      const list = next.get(r.domain) ?? [];
      list.push({
        code: r.code, label: r.label, shortLabel: r.short_label,
        tone: r.ui_tone, sortOrder: r.sort_order,
      });
      next.set(r.domain, list);
    }
    this.cache = next;
    this.loadedAt = Date.now();
  }

  private async ensure() {
    if (Date.now() - this.loadedAt > this.TTL) await this.refresh();
  }

  /** 도메인의 코드 목록. 필터·셀렉트 옵션에 그대로 씁니다. */
  async list(domain: string): Promise<CodeEntry[]> {
    await this.ensure();
    return this.cache.get(domain) ?? [];
  }

  /** 단건 라벨. 미등록 코드는 코드 자체를 돌려주되 경고를 남깁니다. */
  async label(domain: string, code: string): Promise<string> {
    await this.ensure();
    const hit = this.cache.get(domain)?.find((c) => c.code === code);
    if (hit) return hit.label;
    const fallback = codeLabel(domain, code);
    if (fallback === code) {
      console.warn(`[CODE_LABEL_MISSING] ${domain}.${code}`);
    }
    return fallback;
  }

  /** 프런트 부팅 시 한 번에 내려 줍니다. 화면마다 조회하지 않습니다. */
  async bundle(audience: 'USER' | 'ADMIN' = 'USER') {
    await this.ensure();
    const out: Record<string, CodeEntry[]> = {};
    for (const [domain, list] of this.cache) out[domain] = list;
    return { audience, domains: out };
  }
}
