// Copyright 2023 Ready.io

import PQueue from 'p-queue'

export class InMemoryQueues {
  private readonly queues = new Map<string, PQueue>()

  get(key: string): PQueue {
    const existingQueue = this.queues.get(key)
    if (existingQueue) {
      return existingQueue
    }

    const newQueue = new PQueue({ concurrency: 1 })
    newQueue.once('idle', () => {
      this.queues.delete(key)
    })

    this.queues.set(key, newQueue)
    return newQueue
  }

  get allQueues(): ReadonlySet<PQueue> {
    return new Set(this.queues.values())
  }
}
