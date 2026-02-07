/**
 * Golden test vectors — file chunking.
 * These vectors are FROZEN.
 */

import { describe, it, expect } from "vitest";
import { chunkFile, reassembleFile } from "../../src/chunker.js";
import { cidFromBytes, verifyCid } from "../../src/cid.js";
import { CHUNK_SIZE_DEFAULT } from "../../src/constants.js";

describe("file chunking", () => {
  it("single block for small file", () => {
    const data = new TextEncoder().encode("hello world");
    const result = chunkFile(data);

    expect(result.blocks).toHaveLength(1);
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.chunk_size).toBe(CHUNK_SIZE_DEFAULT);
    expect(result.manifest.size).toBe(data.length);
    expect(result.manifest.blocks).toHaveLength(1);
    expect(result.file_root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("multiple blocks for large file", () => {
    // Create a file larger than one chunk
    const chunkSize = 64; // small chunk for testing
    const data = new Uint8Array(chunkSize * 3 + 10); // 3 full chunks + partial
    crypto.getRandomValues(data);

    const result = chunkFile(data, "application/octet-stream", chunkSize);

    expect(result.blocks).toHaveLength(4); // 3 full + 1 partial
    expect(result.manifest.size).toBe(data.length);
    expect(result.manifest.chunk_size).toBe(chunkSize);
    expect(result.manifest.mime).toBe("application/octet-stream");
  });

  it("each block CID matches its content", () => {
    const data = new Uint8Array(200);
    crypto.getRandomValues(data);
    const result = chunkFile(data, undefined, 64);

    for (const block of result.blocks) {
      expect(verifyCid(block.cid, block.bytes)).toBe(true);
    }
  });

  it("reassemble produces original bytes", () => {
    const original = new Uint8Array(500);
    crypto.getRandomValues(original);
    const result = chunkFile(original, undefined, 64);

    const blockMap = new Map(result.blocks.map((b) => [b.cid, b.bytes]));
    const reassembled = reassembleFile(result.manifest, blockMap);

    expect(reassembled).toEqual(original);
  });

  it("reassemble rejects missing block", () => {
    const data = new Uint8Array(200);
    crypto.getRandomValues(data);
    const result = chunkFile(data, undefined, 64);

    const blockMap = new Map(result.blocks.map((b) => [b.cid, b.bytes]));
    // Remove one block
    const firstCid = result.blocks[0]!.cid;
    blockMap.delete(firstCid);

    expect(() => reassembleFile(result.manifest, blockMap)).toThrow(
      "Missing block",
    );
  });

  it("reassemble rejects tampered block", () => {
    const data = new Uint8Array(200);
    crypto.getRandomValues(data);
    const result = chunkFile(data, undefined, 64);

    const blockMap = new Map(result.blocks.map((b) => [b.cid, b.bytes]));
    // Tamper with a block
    const firstCid = result.blocks[0]!.cid;
    const tampered = new Uint8Array(64);
    blockMap.set(firstCid, tampered);

    expect(() => reassembleFile(result.manifest, blockMap)).toThrow(
      "CID mismatch",
    );
  });

  it("file_root is deterministic for same input", () => {
    const data = new TextEncoder().encode("deterministic test content");
    const r1 = chunkFile(data);
    const r2 = chunkFile(data);
    expect(r1.file_root).toBe(r2.file_root);
  });
});
