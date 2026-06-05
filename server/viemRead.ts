import type { Address } from "viem";

/**
 * Vercel's serverless TypeScript pass uses stricter viem `ReadContractParameters`
 * (EIP-7702 `authorizationList`) than our project references catch locally.
 * Route all server-side readContract calls through this helper so API builds stay clean.
 */
export type ReadContractCall = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export type ReadContractClient = {
  readContract: (args: ReadContractCall) => Promise<unknown>;
};

export async function readContractValue<T>(client: unknown, call: ReadContractCall): Promise<T> {
  const read = (client as ReadContractClient).readContract as (args: ReadContractCall) => Promise<unknown>;
  return (await read(call)) as T;
}