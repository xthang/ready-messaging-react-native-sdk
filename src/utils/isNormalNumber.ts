// Copyright 2023 Ready.io

export function isNormalNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)
}
