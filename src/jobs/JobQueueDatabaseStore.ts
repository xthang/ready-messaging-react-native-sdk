// Copyright 2023 Ready.io

import { db as database } from 'db'
import { noop } from 'lodash'
import { logger as log } from 'utils/logger'
import { concat, wrapPromise } from '../utils/asyncIterables'
import { AsyncQueue } from '../utils/AsyncQueue'
import { formatJobForInsert } from './formatJobForInsert'
import type { JobQueueStore, StoredJob } from './types'

type Database = {
  getJobsInQueue(queueType: string): Promise<Array<StoredJob>>
  insertJob(job: Readonly<StoredJob>): Promise<string>
  deleteJob(id: string): Promise<void>
}

class JobQueueDatabaseStore implements JobQueueStore {
  private activeQueueTypes = new Set<string>()

  private queues = new Map<string, AsyncQueue<StoredJob>>()

  private initialFetchPromises = new Map<string, Promise<void>>()

  constructor(private readonly db: Database) {}

  async insert(
    job: Readonly<StoredJob>,
    { shouldPersist = true }: Readonly<{ shouldPersist?: boolean }> = {}
  ): Promise<void> {
    log.info(`JobQueueDatabaseStore adding job ${job.id} to queue ${JSON.stringify(job.queueType)}`)

    const initialFetchPromise = this.initialFetchPromises.get(job.queueType)
    if (!initialFetchPromise) {
      throw new Error(
        `JobQueueDatabaseStore tried to add job for queue ${JSON.stringify(
          job.queueType
        )} but streaming had not yet started`
      )
    }
    await initialFetchPromise

    if (shouldPersist) {
      await this.db.insertJob(formatJobForInsert(job))
    }

    this.getQueue(job.queueType).add(job)
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteJob(id)
  }

  stream(queueType: string): AsyncIterable<StoredJob> {
    if (this.activeQueueTypes.has(queueType)) {
      throw new Error(`Cannot stream queue type ${JSON.stringify(queueType)} more than once`)
    }
    this.activeQueueTypes.add(queueType)

    return concat([wrapPromise(this.fetchJobsAtStart(queueType)), this.getQueue(queueType)])
  }

  private getQueue(queueType: string): AsyncQueue<StoredJob> {
    const existingQueue = this.queues.get(queueType)
    if (existingQueue) {
      return existingQueue
    }

    const result = new AsyncQueue<StoredJob>()
    this.queues.set(queueType, result)
    return result
  }

  private async fetchJobsAtStart(queueType: string): Promise<Array<StoredJob>> {
    log.info(`JobQueueDatabaseStore fetching existing jobs for queue ${JSON.stringify(queueType)}`)

    // This is initialized to `noop` because TypeScript doesn't know that `Promise` calls
    //   its callback synchronously, making sure `onFinished` is defined.
    let onFinished: () => void = noop
    const initialFetchPromise = new Promise<void>((resolve) => {
      onFinished = resolve
    })
    this.initialFetchPromises.set(queueType, initialFetchPromise)

    const result = await this.db.getJobsInQueue(queueType)
    log.info(
      `JobQueueDatabaseStore finished fetching existing ${result.length} jobs for queue ${JSON.stringify(queueType)}`
    )
    onFinished()
    return result
  }
}

export const jobQueueDatabaseStore = new JobQueueDatabaseStore(database)
