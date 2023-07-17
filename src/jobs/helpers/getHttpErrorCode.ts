// Copyright 2023 Ready.io

import { isRecord } from 'utils/isRecord'
import { parseIntOrThrow } from 'utils/parseIntOrThrow'

/**
 * Looks for an HTTP code. First tries the top level error, then looks at its `httpError`
 * property.
 */
export function getHttpErrorCode(maybeError: unknown): number {
  if (!isRecord(maybeError)) {
    return -1
  }

  try {
    // This might be a textsecure/Errors/HTTPError
    const maybeTopLevelCode = parseIntOrThrow(maybeError.code)
    if (maybeTopLevelCode !== -1) {
      return maybeTopLevelCode
    }
  } catch (e) {}

  // Various errors in textsecure/Errors have a nested httpError property
  const { httpError } = maybeError
  if (!isRecord(httpError)) {
    return -1
  }

  try {
    return parseIntOrThrow(httpError.code)
  } catch (e) {
    return -1
  }
}
