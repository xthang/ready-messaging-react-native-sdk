// Copyright 2023 Ready.io

export function toLogFormat(error: unknown): string {
  let result = ''
  if (error instanceof Error) {
    result = `[${error.name}] ${error.message}`
    if (error.stack) {
      result += `\n${error.stack}`
    }
  } else if (error && typeof error === 'object' && 'message' in error) {
    result = String(error.message)
  } else {
    result = String(error)
  }

  if (error && typeof error === 'object') {
    if ('code' in error) {
      result = `[${error.code}] ${result}`
    }
    if ('cause' in error) {
      result += `\nCaused by: ${String(error.cause)}`
    }
  }

  return result
}

export class ProfileDecryptError extends Error {}
