/* eslint-disable import/no-unused-modules */

export type AccountIdStringType = string
export type AccountAddressStringType = string
export type AccountDBType = {
  id: string
  address: AccountAddressStringType
  registrationId: number // Self gen
  publicKey: string
  privateKey: string
}
