// Copyright 2023 Ready.io

export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined = setTimeout(resolve, ms)

    abortSignal?.addEventListener('abort', () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
        timeout = undefined
      }
      reject(new Error('Aborted'))
    })
  })
}
