declare module "luxon" {
  export class DateTime {
    static utc(): DateTime;
    static fromISO(s: string): DateTime;
    toISO(): string;
  }
  export class IANAZone {}
}
