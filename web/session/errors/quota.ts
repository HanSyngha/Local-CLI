/**
 * Quota Error Classes
 *
 *     
 */

export interface QuotaPeriodInfo {
  percentage: number;
  resetsIn: number;
  timeDisplay: string;
  totalTimeDisplay: string;
}

export interface QuotaInfo {
  period: QuotaPeriodInfo;
  weekly: QuotaPeriodInfo;
}

export class QuotaExceededError extends Error {
  public quota: QuotaInfo;

  constructor(quota: QuotaInfo) {
    const msg = `  . : ${quota.period.timeDisplay} , : ${quota.weekly.timeDisplay} `;
    super(msg);
    this.name = 'QuotaExceededError';
    this.quota = quota;
  }
}
