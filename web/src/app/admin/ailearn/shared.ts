

export interface LearnSet {
  classify: { enabled: boolean; minSignals: number; maxWeight: number; vocab: number };
  risk: { enabled: boolean; minSignals: number; expireDays: number; lawExempted: number };
}
