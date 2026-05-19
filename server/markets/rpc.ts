/**
 * Server-side Arc RPC helpers.
 *
 * Browser/shared code already exposes an Arc public client, but backend flows
 * need their own failover client so admin/indexer paths are resilient when a
 * single Arc endpoint flakes.
 */

import { createPublicClient, fallback, http } from "viem";
import { ARC_RPC_ENDPOINTS, arcTestnet } from "../../src/lib/arc.js";

export function createServerArcPublicClient(options?: { timeoutMs?: number }) {
  const timeout = options?.timeoutMs ?? 10_000;
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(
      ARC_RPC_ENDPOINTS.map((endpoint) =>
        http(endpoint.url, {
          timeout,
        })
      ),
      {
        retryCount: 2,
      }
    ),
  });
}

