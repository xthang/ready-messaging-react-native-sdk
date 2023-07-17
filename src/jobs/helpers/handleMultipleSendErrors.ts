// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { SendMessageProtoError } from 'textsecure/Errors'
import * as Errors from 'types/errors'
import { strictAssert } from 'utils/assert'
import type { LoggerType } from 'utils/logger'
import { findRetryAfterTimeFromError } from './findRetryAfterTimeFromError'
import { getHttpErrorCode } from './getHttpErrorCode'
import { sleepForRateLimitRetryAfterTime } from './sleepForRateLimitRetryAfterTime'

export function maybeExpandErrors(error: unknown): ReadonlyArray<unknown> {
  if (error instanceof SendMessageProtoError) {
    return error.errors || [error]
  }

  return [error]
}

// Note: toThrow is very important to preserve the full error for outer handlers. For
//   example, the catch handler check for Safety Number Errors in conversationJobQueue.
export async function handleMultipleSendErrors({
  errors,
  isFinalAttempt,
  log,
  markFailed,
  timeRemaining,
  toThrow,
}: Readonly<{
  errors: ReadonlyArray<unknown>
  isFinalAttempt: boolean
  log: Pick<LoggerType, 'info'>
  markFailed?: () => void | Promise<void>
  timeRemaining: number
  toThrow?: unknown
}>): Promise<void> {
  strictAssert(errors.length, 'Expected at least one error')

  const formattedErrors: Array<string> = []
  // const apiErrors: ApiError[] = []

  let retryAfterError: unknown
  let longestRetryAfterTime = -Infinity

  let serverAskedUsToStop = false

  errors.forEach((error) => {
    formattedErrors.push(Errors.toLogFormat(error))

    const errorCode = getHttpErrorCode(error)
    if (errorCode === 413 || errorCode === 429) {
      const retryAfterTime = findRetryAfterTimeFromError(error)
      if (retryAfterTime > longestRetryAfterTime) {
        retryAfterError = error
        longestRetryAfterTime = retryAfterTime
      }
    } else if (errorCode === 508 || errorCode === 400) {
      serverAskedUsToStop = true
    } else if (error instanceof SendMessageProtoError) {
      // error.errors?.forEach((e) => {
      //   if (e instanceof ApiError) {
      //     apiErrors.push(e)
      //   }
      // })
    }
  })

  log.info(`${formattedErrors.length} send error(s): ${formattedErrors.join(',\n')}`)

  if (isFinalAttempt || serverAskedUsToStop) {
    // if (apiErrors.length) window.utils.notifyApiError(apiErrors[0].problem)
    // else window.utils.notify('error', (errors[0] as any).message ?? errors[0]!.toString())

    await markFailed?.()
  }

  if (serverAskedUsToStop) {
    log.info('server responded with 508 or 400. Giving up on this job')
    return
  }

  if (retryAfterError && !isFinalAttempt) {
    await sleepForRateLimitRetryAfterTime({
      err: retryAfterError,
      log,
      timeRemaining,
    })
  }

  if (toThrow) throw toThrow
}
