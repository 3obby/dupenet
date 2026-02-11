/**
 * GET /api/download/:ref — File download proxy.
 *
 * Resolves asset → manifest → fetches blocks → assembles → streams as download.
 * Works for open-access content (free preview tier blocks ≤16 KiB).
 * Returns 402 with price info if any block is behind L402.
 */

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:3100";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;

  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return Response.json({ error: "invalid_ref" }, { status: 400 });
  }

  try {
    // 1. Try as asset root → manifest → blocks → assembled file
    const assetRes = await fetch(`${GATEWAY}/asset/${ref}`, { cache: "no-store" });

    if (assetRes.ok) {
      const asset = (await assetRes.json()) as {
        kind: string;
        original: { file_root: string; mime?: string; size: number };
      };

      const mime = asset.original.mime ?? "application/octet-stream";

      // Get manifest
      const fileRes = await fetch(`${GATEWAY}/file/${asset.original.file_root}`, {
        cache: "no-store",
      });
      if (!fileRes.ok) {
        return Response.json({ error: "manifest_not_found" }, { status: 404 });
      }

      const manifest = (await fileRes.json()) as { blocks: string[] };

      // Fetch all blocks
      const chunks: Uint8Array[] = [];
      for (const blockCid of manifest.blocks) {
        const blockRes = await fetch(`${GATEWAY}/block/${blockCid}`, {
          cache: "no-store",
        });
        if (!blockRes.ok) {
          // L402-gated — content requires payment
          return Response.json(
            {
              error: "payment_required",
              message: "This content requires Lightning payment. Use `dupenet fetch` with a Lightning wallet.",
              ref,
              mime,
              size: asset.original.size,
              blocks: manifest.blocks.length,
              blocks_fetched: chunks.length,
            },
            { status: 402 },
          );
        }
        chunks.push(new Uint8Array(await blockRes.arrayBuffer()));
      }

      // Assemble
      const totalSize = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }

      // Derive filename from ref + mime
      const ext = mimeToExt(mime);
      const filename = `${ref.slice(0, 12)}${ext}`;

      return new Response(combined, {
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(totalSize),
          "X-Content-Ref": ref,
        },
      });
    }

    // 2. Try as raw block
    const blockRes = await fetch(`${GATEWAY}/block/${ref}`, { cache: "no-store" });
    if (blockRes.ok) {
      const bytes = new Uint8Array(await blockRes.arrayBuffer());
      const filename = `${ref.slice(0, 12)}.bin`;
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(bytes.length),
          "X-Content-Ref": ref,
        },
      });
    }

    if (blockRes.status === 402) {
      return Response.json(
        {
          error: "payment_required",
          message: "This content requires Lightning payment. Use `dupenet fetch` with a Lightning wallet.",
          ref,
        },
        { status: 402 },
      );
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: "fetch_failed", detail: String(e) }, { status: 502 });
  }
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "text/plain": ".txt",
    "text/html": ".html",
    "text/csv": ".csv",
    "text/markdown": ".md",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
  };
  return map[mime] ?? ".bin";
}
