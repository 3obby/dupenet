/**
 * Host registry materialized view.
 * DocRef: MVP_PLAN:§Node Operator Model, §Enforcement
 *
 * Materialized from host register/unbond events.
 * Tracks status lifecycle: PENDING → TRUSTED → DEGRADED → INACTIVE → UNBONDING
 */

import {
  OPERATOR_STAKE_SATS,
  type CID,
  type HostStatus,
} from "@dupenet/physics";

export interface HostRecord {
  pubkey: string;
  endpoint: string | null;
  stake: number;
  status: HostStatus;
  pricing: { min_request_sats: number; sats_per_gb: number };
  availability_score: number;
  served_cids: Set<CID>;
  registered_epoch: number;
  unbond_epoch?: number;
}

const hosts = new Map<string, HostRecord>();

export function registerHost(
  pubkey: string,
  endpoint: string | null,
  pricing: { min_request_sats: number; sats_per_gb: number },
  epoch: number,
): HostRecord {
  const record: HostRecord = {
    pubkey,
    endpoint,
    stake: OPERATOR_STAKE_SATS,
    status: "PENDING",
    pricing,
    availability_score: 0,
    served_cids: new Set(),
    registered_epoch: epoch,
  };
  hosts.set(pubkey, record);
  return record;
}

export function getHost(pubkey: string): HostRecord | undefined {
  return hosts.get(pubkey);
}

export function getAllHosts(): readonly HostRecord[] {
  return [...hosts.values()];
}

export function updateStatus(pubkey: string, status: HostStatus): boolean {
  const host = hosts.get(pubkey);
  if (!host) return false;
  host.status = status;
  return true;
}

export function updateAvailability(pubkey: string, score: number): void {
  const host = hosts.get(pubkey);
  if (!host) return;
  host.availability_score = score;

  // Status transitions based on score
  if (score >= 0.6 && host.status === "PENDING") {
    host.status = "TRUSTED";
  } else if (score >= 0.6 && host.status === "DEGRADED") {
    host.status = "TRUSTED";
  } else if (score < 0.6 && host.status === "TRUSTED") {
    host.status = "DEGRADED";
  } else if (score === 0 && host.status !== "UNBONDING") {
    host.status = "INACTIVE";
  }
}

export function addServedCid(pubkey: string, cid: CID): void {
  const host = hosts.get(pubkey);
  if (host) host.served_cids.add(cid);
}
