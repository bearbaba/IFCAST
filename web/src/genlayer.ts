import { createClient, isSuccessful } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

export const TOKENS = ['BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'AVAX', 'LINK', 'XRP'] as const;
export type Token = typeof TOKENS[number];
export type MarketKind = 'TOUCH_ABOVE' | 'TOUCH_BELOW' | 'OUTPERFORM';
export type Side = 'YES' | 'NO';
export type MarketStatus = 'OPEN' | 'RESOLVED' | 'VOID';
export interface Market {
  id: number; creator: string; kind: MarketKind; token_a: Token; token_b: Token | '';
  target_e8: number; start_at: number; end_at: number; duration_hours: number;
  close_at: number; resolve_after: number; source: string; status: MarketStatus;
  outcome: '' | 'YES' | 'NO' | 'VOID'; reason: string; evidence_digest: string;
  yes_pool: number; no_pool: number; attempts: number; last_attempt_at: number;
}
export interface Position { side: Side; amount: number; claimed: boolean }
export type Tx = { hash: string; label: string; at: number; status: 'pending' | 'finalized' | 'unverified' | 'failed'; error?: string };
type Provider = {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[])=>void) => void;
  removeListener?: (event: string, cb: (...args: unknown[])=>void) => void;
};
declare global { interface Window { ethereum?: Provider } }

// Deliberately NO fallback to the deployed v0.1 GitHub-only contract.
export const contractAddress = import.meta.env.VITE_IFCAST_CRYPTO_V02_ADDRESS as string | undefined;
export const ready = !!contractAddress && /^0x[a-fA-F0-9]{40}$/.test(contractAddress);
const readonlyClient = createClient({ chain: studionet });
const requireContract = (): `0x${string}` => {
  if (!ready) throw new Error('Crypto v0.2 is not deployed/configured. Set VITE_IFCAST_CRYPTO_V02_ADDRESS after verifying the new Studionet contract.');
  return contractAddress as `0x${string}`;
};
export async function read<T>(functionName: string, args: (string | number)[] = []): Promise<T> {
  return await readonlyClient.readContract({ address: requireContract(), functionName, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL }) as T;
}
export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error('A compatible wallet such as MetaMask is required.');
  const accounts = await window.ethereum.request({method: 'eth_requestAccounts'}) as string[];
  const account = accounts?.[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(account ?? '')) throw new Error('No valid wallet address returned.');
  const client = createClient({chain: studionet, account: account as `0x${string}`, provider: window.ethereum});
  await client.connect('studionet');
  return account;
}
export async function write(functionName: string, args: (string | number)[], account: string, onHash: (hash: string)=>void) {
  if (!window.ethereum || !/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error('Connect your wallet first.');
  const client = createClient({chain: studionet, account: account as `0x${string}`, provider: window.ethereum});
  await client.connect('studionet');
  const tx = {address: requireContract(), functionName, args};
  const estimate = await client.estimateTransactionFeesForWrite(tx);
  const hash = await client.writeContract({...tx, fees: {distribution: estimate.distribution, feeValue: estimate.feeValue}});
  onHash(hash);
  const receipt = await readonlyClient.waitForFinalization({hash});
  if (!isSuccessful(receipt)) throw new Error('Transaction reached finalization without successful execution. Check GenLayer Explorer.');
  return hash;
}
