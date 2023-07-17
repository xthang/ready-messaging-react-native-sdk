// Copyright 2023 Ready.io

import type { ParsedJob } from './types'

/**
 * A single job instance. Shouldn't be instantiated directly, except by `JobQueue`.
 */
export class Job<T> implements ParsedJob<T> {
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly queueType: string,
    readonly data: T,
    readonly completion: Promise<void>
  ) {}
}
