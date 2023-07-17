// Copyright 2023 Ready.io

import { isRecord } from 'utils/isRecord'
import { parseRetryAfterWithDefault } from 'utils/parseRetryAfter'
import { HTTPError } from '../../textsecure/Errors'

export function findRetryAfterTimeFromError(err: unknown): number {
  let rawValue: unknown

  if (isRecord(err)) {
    if (isRecord(err.responseHeaders)) {
      rawValue = err.responseHeaders['retry-after']
    } else if (err.httpError instanceof HTTPError) {
      rawValue = err.httpError.responseHeaders?.['retry-after']
    }
  }

  return parseRetryAfterWithDefault(rawValue)
}
