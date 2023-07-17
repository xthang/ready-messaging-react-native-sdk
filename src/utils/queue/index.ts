import PQueue from 'p-queue'

export const dbQueue = new PQueue({ concurrency: 1 })
export const downloadQueue = new PQueue({ concurrency: 1 })
