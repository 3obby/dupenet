/**
 * Gateway integration test — full round-trip.
 * DocRef: MVP_PLAN:§Phase 1 Step 1 (Exit Criterion)
 *
 * "Upload a multi-block file, retrieve it by asset_root,
 *  verify SHA256(reassembled_bytes) == original."
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  chunkFile,
  reassembleFile,
  cidFromObject,
  cidFromBytes,
  CHUNK_SIZE_DEFAULT,
  type CID,
  type AssetRootV1,
  type FileManifestV1,
} from "@dupenet/physics";

let app: FastifyInstance;
let tmpDir: string;

describe("gateway round-trip", () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gateway-test-"));
    process.env.BLOCK_STORE_PATH = tmpDir;

    // Dynamic import so env override is picked up before config loads
    const { buildApp } = await import("../../src/server.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── edge cases ────────────────────────────────────────────────────

  it("PUT /block rejects mismatched CID", async () => {
    const bytes = new TextEncoder().encode("test block data");
    const fakeCid = "a".repeat(64);

    const res = await app.inject({
      method: "PUT",
      url: `/block/${fakeCid}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });

    expect(res.statusCode).toBe(422);
  });

  it("GET /block returns 404 for missing block", async () => {
    const missingCid = "b".repeat(64);

    const res = await app.inject({
      method: "GET",
      url: `/block/${missingCid}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("PUT /file rejects manifest when blocks are missing", async () => {
    const manifest: FileManifestV1 = {
      version: 1,
      chunk_size: CHUNK_SIZE_DEFAULT,
      size: 100,
      blocks: ["c".repeat(64)],
      merkle_root: "d".repeat(64),
    };
    const fileRoot = cidFromObject(manifest);

    const res = await app.inject({
      method: "PUT",
      url: `/file/${fileRoot}`,
      headers: { "content-type": "application/json" },
      payload: manifest,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("missing_block");
  });

  it("PUT /block is idempotent", async () => {
    const bytes = new TextEncoder().encode("idempotent block test");
    const cid = cidFromBytes(bytes);

    const res1 = await app.inject({
      method: "PUT",
      url: `/block/${cid}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });
    expect(res1.statusCode).toBe(201);

    const res2 = await app.inject({
      method: "PUT",
      url: `/block/${cid}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });
    expect(res2.statusCode).toBe(201);

    const getRes = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(new Uint8Array(getRes.rawPayload)).toEqual(bytes);
  });

  // ── full round-trip ───────────────────────────────────────────────

  it("upload multi-block file, retrieve via asset root, verify SHA256", async () => {
    // ── 1. Create deterministic test data (3 blocks) ──
    const fileBytes = new Uint8Array(CHUNK_SIZE_DEFAULT * 2 + 1000);
    for (let i = 0; i < fileBytes.length; i++) {
      fileBytes[i] = i % 256;
    }
    const originalHash = cidFromBytes(fileBytes);

    // ── 2. Chunk locally ──
    const { blocks, manifest, file_root } = chunkFile(
      fileBytes,
      "application/octet-stream",
    );
    expect(blocks.length).toBe(3); // 2 full + 1 partial

    // ── 3. PUT /block x N ──
    for (const block of blocks) {
      const res = await app.inject({
        method: "PUT",
        url: `/block/${block.cid}`,
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from(block.bytes),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ ok: true, cid: block.cid });
    }

    // ── 4. PUT /file ──
    const fileRes = await app.inject({
      method: "PUT",
      url: `/file/${file_root}`,
      headers: { "content-type": "application/json" },
      payload: manifest,
    });
    expect(fileRes.statusCode).toBe(201);
    expect(fileRes.json()).toEqual({ ok: true, file_root });

    // ── 5. Build + PUT /asset ──
    const assetRoot: AssetRootV1 = {
      version: 1,
      kind: "FILE",
      original: {
        file_root,
        size: fileBytes.length,
        mime: "application/octet-stream",
      },
      variants: [],
      meta: {
        sha256_original: originalHash,
      },
    };
    const assetRootCid = cidFromObject(assetRoot);

    const assetRes = await app.inject({
      method: "PUT",
      url: `/asset/${assetRootCid}`,
      headers: { "content-type": "application/json" },
      payload: assetRoot,
    });
    expect(assetRes.statusCode).toBe(201);
    expect(assetRes.json()).toEqual({ ok: true, asset_root: assetRootCid });

    // ── 6. GET /asset ──
    const getAsset = await app.inject({
      method: "GET",
      url: `/asset/${assetRootCid}`,
    });
    expect(getAsset.statusCode).toBe(200);
    const retrievedAsset = getAsset.json() as AssetRootV1;
    expect(retrievedAsset.kind).toBe("FILE");
    expect(retrievedAsset.original.file_root).toBe(file_root);
    expect(retrievedAsset.original.size).toBe(fileBytes.length);

    // ── 7. HEAD /asset ──
    const headAsset = await app.inject({
      method: "HEAD",
      url: `/asset/${assetRootCid}`,
    });
    expect(headAsset.statusCode).toBe(200);
    expect(headAsset.headers["x-asset-size"]).toBe(String(fileBytes.length));
    expect(headAsset.headers["x-asset-kind"]).toBe("FILE");
    expect(headAsset.headers["content-type"]).toContain(
      "application/octet-stream",
    );

    // ── 8. GET /file ──
    const getFile = await app.inject({
      method: "GET",
      url: `/file/${file_root}`,
    });
    expect(getFile.statusCode).toBe(200);
    const retrievedManifest = getFile.json() as FileManifestV1;
    expect(retrievedManifest.version).toBe(1);
    expect(retrievedManifest.size).toBe(fileBytes.length);
    expect(retrievedManifest.blocks).toHaveLength(3);
    expect(retrievedManifest.merkle_root).toBe(manifest.merkle_root);

    // ── 9. GET /block x N ──
    const retrievedBlocks = new Map<CID, Uint8Array>();
    for (const blockCid of retrievedManifest.blocks) {
      const blockRes = await app.inject({
        method: "GET",
        url: `/block/${blockCid}`,
      });
      expect(blockRes.statusCode).toBe(200);
      expect(blockRes.headers["content-type"]).toBe(
        "application/octet-stream",
      );
      expect(blockRes.headers["x-content-cid"]).toBe(blockCid);
      retrievedBlocks.set(
        blockCid as CID,
        new Uint8Array(blockRes.rawPayload),
      );
    }

    // ── 10. Reassemble + verify ──
    const reassembled = reassembleFile(retrievedManifest, retrievedBlocks);
    expect(reassembled.length).toBe(fileBytes.length);
    expect(cidFromBytes(reassembled)).toBe(originalHash);
    expect(Buffer.from(reassembled).equals(Buffer.from(fileBytes))).toBe(true);
  });

  // ── utility routes ────────────────────────────────────────────────

  it("GET /pricing returns valid pricing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/pricing",
    });
    expect(res.statusCode).toBe(200);
    const pricing = res.json();
    expect(pricing.min_request_sats).toBeGreaterThanOrEqual(1);
    expect(pricing.sats_per_gb).toBeGreaterThanOrEqual(1);
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
