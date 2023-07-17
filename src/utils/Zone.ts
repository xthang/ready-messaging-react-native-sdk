// Copyright 2023 Ready.io

export type ZoneOptions = {
  readonly pendingSenderKeys?: boolean
  readonly pendingSessions?: boolean
  readonly pendingUnprocessed?: boolean
}

export class Zone {
  constructor(public readonly name: string, private readonly options: ZoneOptions = {}) {}

  public supportsPendingSenderKeys(): boolean {
    return this.options.pendingSenderKeys === true
  }

  public supportsPendingSessions(): boolean {
    return this.options.pendingSessions === true
  }

  public supportsPendingUnprocessed(): boolean {
    return this.options.pendingUnprocessed === true
  }
}
