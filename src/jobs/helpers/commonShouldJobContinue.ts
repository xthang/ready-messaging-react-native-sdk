// Copyright 2023 Ready.io

import { exponentialBackoffSleepTime } from 'utils/exponentialBackoff'
import { type LoggerType } from 'utils/logger'
import { sleeper } from 'utils/sleeper'
// import { isDone as isDeviceLinked } from '../../util/registration'

export async function commonShouldJobContinue({
  attempt,
  log,
  timeRemaining,
  skipWait,
}: Readonly<{
  attempt: number
  log: LoggerType
  timeRemaining: number
  skipWait: boolean
}>): Promise<boolean> {
  if (timeRemaining <= 0) {
    log.info("giving up because it's been too long")
    return false
  }

  // try {
  //   await waitForOnline(window.navigator, window, { timeout: timeRemaining })
  // } catch (err: unknown) {
  //   log.info("didn't come online in time, giving up")
  //   return false
  // }

  // await new Promise<void>((resolve) => {
  //   window.storage.onready(resolve)
  // })

  // if (!isDeviceLinked()) {
  //   log.info("skipping this job because we're unlinked")
  //   return false
  // }

  if (skipWait) {
    return true
  }

  const sleepTime = exponentialBackoffSleepTime(attempt)
  log.info(`sleeping for ${sleepTime}`)
  await sleeper.sleep(sleepTime, `commonShouldJobContinue: attempt ${attempt}, skipWait ${skipWait}`)

  return true
}
