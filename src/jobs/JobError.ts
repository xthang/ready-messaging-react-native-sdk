// Copyright 2023 Ready.io

/**
 * An error that wraps job errors.
 *
 * Should not be instantiated directly, except by `JobQueue`.
 */
export class JobError extends Error {
  constructor(public readonly lastErrorThrownByJob: unknown) {
    super(`Job failed. Last error: ${formatError(lastErrorThrownByJob)}`)
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return JSON.stringify(err)
}
