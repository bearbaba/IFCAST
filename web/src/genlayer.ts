import { createClient, isSuccessful } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

export type Side = 'YES' | 'NO';
export type MarketStatus = 'OPEN' | 'RESOLVED' | 'VOID';
export interface Market {
  id: number; creator: string; title: string; condition: string; target: string;
  condition_url: string; target_url: string; created_at: number; close_at: number;
  resolve_after: number; status: MarketStatus; outcome: '' | 'YES' | 'NO' | 'VOID';
  yes_pool: number; no_pool: number; reason: string; attempts: number; last_attempt_at: number;
}
export interface Position { side: Side; amount: number; claimed: boolean }
export type Tx = {hash: string; label: string; status: 'pending' | 'finalized' | 'failed' | 'unverified'; at: number; error?: string};

type WalletProvider = {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: WalletProvider } }

export const contractAddress = import.meta.env.VITE_IFCAST_CONTRACT_ADDRESS as string | undefined;
export const ready = !!contractAddress && /^0x[a-fA-F0-9]{40}$/.test(contractAddress);
const readClient = createClient({chain:studionet});
const deployedAddress = () => {
  if (!ready) throw new Error('Contract address is missing or invalid. Configure VITE_IFCAST_CONTRACT_ADDRESS.');
  return contractAddress as `0x${string}`;
};

export async function read<T>(fn: string, args: (string | number)[] = []): Promise<T> {
  return await readClient.readContract({ address:deployedAddress(), functionName:fn, args }) as T;
}

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error('Install an EIP-1193 wallet such as MetaMask.');
  const accounts = await window.ethereum.request({method:'eth_requestAccounts'}) as string[];
  const address = accounts[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? '')) throw new Error('Wallet did not return an address.');
  const client = createClient({chain:studionet, account: address as `0x${string}`, provider:window.ethereum});
  await client.connect('studionet');
  return address;
}

export async function write(fn: string, args: (string | number)[], address: string, onHash: (hash: string) => void): Promise<string> {
  if (!window.ethereum) throw new Error('No wallet provider found.');
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Connect a wallet first.');
  const client = createClient({chain:studionet, account:address as `0x${string}`, provider:window.ethereum});
  await client.connect('studionet');
  const writeInput = { address:deployedAddress(), functionName:fn, args };
  // Never guess fees on a fee-charging chain; abort when estimation fails.
  const estimate = await client.estimateTransactionFeesForWrite(writeInput);
  const hash = await client.writeContract({
    ...writeInput,
    fees: {distribution:estimate.distribution, feeValue:estimate.feeValue},
  });
  onHash(hash);
  const receipt = await readClient.waitForFinalization({hash});
  if (!isSuccessful(receipt)) throw new Error('Transaction finalized without a successful execution. Inspect its receipt.');
  return hash;
}
