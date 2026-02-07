/**
 * Content-addressed block storage on local filesystem.
 * DocRef: MVP_PLAN:§Phase 1 Step 1
 *
 * Layout: {basePath}/{hash[0:2]}/{hash[2:4]}/{hash}
 * SHA256 verified on write. Immutable once written.
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { cidFromBytes, verifyCid, type CID } from "@dupenet/physics";

export class BlockStore {
  constructor(private readonly basePath: string) {}

  private blockPath(cid: CID): string {
    return join(this.basePath, cid.substring(0, 2), cid.substring(2, 4), cid);
  }

  private blockDir(cid: CID): string {
    return join(this.basePath, cid.substring(0, 2), cid.substring(2, 4));
  }

  /**
   * Store a block. Verifies SHA256 matches the claimed CID.
   * No-op if block already exists (content-addressed = idempotent).
   */
  async put(cid: CID, bytes: Uint8Array): Promise<void> {
    // Verify hash
    if (!verifyCid(cid, bytes)) {
      const actual = cidFromBytes(bytes);
      throw new Error(`Block hash mismatch: claimed ${cid}, actual ${actual}`);
    }

    // Skip if already exists
    const path = this.blockPath(cid);
    try {
      await access(path);
      return; // Already stored
    } catch {
      // Not found, proceed to write
    }

    await mkdir(this.blockDir(cid), { recursive: true });
    await writeFile(path, bytes);
  }

  /**
   * Retrieve a block by CID.
   * Returns null if not found.
   */
  async get(cid: CID): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(this.blockPath(cid));
      return new Uint8Array(bytes);
    } catch {
      return null;
    }
  }

  /**
   * Check if a block exists.
   */
  async has(cid: CID): Promise<boolean> {
    try {
      await access(this.blockPath(cid));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the store directory.
   */
  async init(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
  }
}
