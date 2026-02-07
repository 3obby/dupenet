/**
 * dupenet hosts
 *
 * GET /directory → print host list + pricing + status.
 * DocRef: MVP_PLAN:§Directory Format
 */

import type { CliConfig } from "../lib/config.js";
import { httpGet } from "../lib/http.js";

interface DirectoryHost {
  pubkey: string;
  endpoint: string;
  status: string;
  pricing?: {
    min_request_sats: number;
    sats_per_gb: number;
  };
  regions?: string[];
}

interface DirectoryResponse {
  hosts: DirectoryHost[];
}

export async function hostsCommand(config: CliConfig): Promise<void> {
  const dir = await httpGet<DirectoryResponse>(
    `${config.coordinator}/directory`,
  );

  if (dir.hosts.length === 0) {
    console.log("No hosts registered.");
    return;
  }

  console.log(`${dir.hosts.length} host(s):\n`);

  for (const host of dir.hosts) {
    console.log(`  ${host.pubkey.slice(0, 16)}...`);
    console.log(`    endpoint: ${host.endpoint}`);
    console.log(`    status:   ${host.status}`);
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
