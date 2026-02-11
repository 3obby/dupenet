/**
 * dupenet hosts
 *
 * GET /directory → print host list + pricing + status.
 * Uses multi-endpoint rotation for coordinator queries.
 * DocRef: MVP_PLAN:§Directory Format
 */

import type { CliConfig } from "../lib/config.js";
import { httpGetRotate } from "../lib/http.js";

interface DirectoryHost {
  pubkey: string;
  endpoint: string;
  status: string;
  pricing?: {
    min_request_sats: number;
    sats_per_gb: number;
  };
  availability_score?: number;
  regions?: string[];
}

interface DirectoryResponse {
  hosts: DirectoryHost[];
}

export async function hostsCommand(config: CliConfig): Promise<void> {
  const coordinators = config.coordinators.length > 0
    ? config.coordinators
    : [config.coordinator];

  const dir = await httpGetRotate<DirectoryResponse>(
    coordinators,
    "/directory",
  );

  if (dir.hosts.length === 0) {
    console.log("No hosts registered.");
    return;
  }

  console.log(`${dir.hosts.length} host(s):\n`);

  for (const host of dir.hosts) {
    const score = host.availability_score !== undefined
      ? ` (avail: ${(host.availability_score * 100).toFixed(0)}%)`
      : "";
    console.log(`  ${host.pubkey.slice(0, 16)}...`);
    console.log(`    endpoint: ${host.endpoint}`);
    console.log(`    status:   ${host.status}${score}`);
    if (host.pricing) {
      console.log(
        `    pricing:  ${host.pricing.min_request_sats} sats/req, ${host.pricing.sats_per_gb} sats/GB`,
      );
    }
    if (host.regions && host.regions.length > 0) {
      console.log(`    regions:  ${host.regions.join(", ")}`);
    }
    console.log();
  }
}
