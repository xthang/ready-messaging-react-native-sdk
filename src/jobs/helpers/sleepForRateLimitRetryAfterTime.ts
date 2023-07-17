// Copyright 2023 Ready.io

import type { LoggerType } from 'utils/logger'
import { sleeper } from 'utils/sleeper'
// import { sleeper } from '../../util/sleeper'
import { findRetryAfterTimeFromError } from './findRetryAfterTimeFromError'

export async function sleepForRateLimitRetryAfterTime({
  err,
  log,
  timeRemaining,
}: Readonly<{
  err: unknown
  log: Pick<LoggerType, 'info'>
  timeRemaining: number
}>): Promise<void> {
  if (timeRemaining <= 0) {
    return
  }

  const retryAfter = Math.min(findRetryAfterTimeFromError(err), timeRemaining)

  log.info(`Got a 413 or 429 response code. Sleeping for ${retryAfter} millisecond(s)`)

  await sleeper.sleep(retryAfter, 'sleepForRateLimitRetryAfterTime: Got a 413 or 429 response code', {
    resolveOnShutdown: false,
  })
}
