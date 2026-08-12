/**
 * EIP-1967 proxy resolution.
 * Reads the implementation slot to get the logic contract address.
 */

import type { PublicClient, Address } from "viem";

// EIP-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

export async function resolveImplementation(
  client: PublicClient,
  address: Address,
): Promise<Address | null> {
  try {
    const slot = await client.getStorageAt({
      address,
      slot: EIP1967_IMPL_SLOT,
    });
    if (!slot || slot === "0x" + "0".repeat(64)) return null;
    // Extract address from 32-byte slot (last 20 bytes)
    const impl = ("0x" + slot.slice(26)) as Address;
    // Check it's not zero
    if (impl === "0x0000000000000000000000000000000000000000") return null;
    return impl;
  } catch {
    return null;
  }
}
