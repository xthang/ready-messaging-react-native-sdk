// Copyright 2023 Ready.io

export function parseIntOrThrow(value: unknown): number {
  let result: number

  switch (typeof value) {
    case 'number':
      result = value
      break
    case 'string':
      result = parseInt(value, 10)
      break
    default:
      result = NaN
      break
  }

  if (!Number.isInteger(result)) {
    throw new Error('parsed output is not an integer')
  }

  return result
}
