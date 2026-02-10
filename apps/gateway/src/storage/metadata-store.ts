/**
 * Persistent metadata store for file manifests and asset roots.
 * Stores JSON files on disk alongside blocks so metadata survives restarts.
 *
 * Layout:
 *   {basePath}/_meta/manifests/{hash}.json
 *   {basePath}/_meta/assets/{hash}.json
 */

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CID, FileManifestV1, AssetRootV1 } from "@dupenet/physics";

export class MetadataStore {
  private readonly manifestDir: string;
  private readonly assetDir: string;

  private manifests = new Map<CID, FileManifestV1>();
  private assets = new Map<CID, AssetRootV1>();

  constructor(basePath: string) {
    this.manifestDir = join(basePath, "_meta", "manifests");
    this.assetDir = join(basePath, "_meta", "assets");
  }

  /** Create directories and load all persisted metadata into memory. */
  async init(): Promise<void> {
    await mkdir(this.manifestDir, { recursive: true });
    await mkdir(this.assetDir, { recursive: true });

    // Load manifests
    const manifestFiles = await readdir(this.manifestDir).catch(() => []);
    for (const f of manifestFiles) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = await readFile(join(this.manifestDir, f), "utf-8");
        const cid = f.replace(".json", "") as CID;
        this.manifests.set(cid, JSON.parse(data) as FileManifestV1);
      } catch {
        // Skip corrupt files
      }
    }

    // Load assets
    const assetFiles = await readdir(this.assetDir).catch(() => []);
    for (const f of assetFiles) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = await readFile(join(this.assetDir, f), "utf-8");
        const cid = f.replace(".json", "") as CID;
        this.assets.set(cid, JSON.parse(data) as AssetRootV1);
      } catch {
        // Skip corrupt files
      }
    }

    console.log(
      `[metadata] loaded ${this.manifests.size} manifests, ${this.assets.size} assets`,
    );
  }

  // ── Manifests ────────────────────────────────────────────────

  async putManifest(cid: CID, manifest: FileManifestV1): Promise<void> {
    this.manifests.set(cid, manifest);
    await writeFile(
      join(this.manifestDir, `${cid}.json`),
      JSON.stringify(manifest),
    );
  }

  getManifest(cid: CID): FileManifestV1 | undefined {
    return this.manifests.get(cid);
  }

  // ── Assets ───────────────────────────────────────────────────

  async putAsset(cid: CID, asset: AssetRootV1): Promise<void> {
    this.assets.set(cid, asset);
    await writeFile(
      join(this.assetDir, `${cid}.json`),
      JSON.stringify(asset),
    );
  }

  getAsset(cid: CID): AssetRootV1 | undefined {
    return this.assets.get(cid);
  }
}
