#!/usr/bin/env node
/**
 * dupenet CLI — the minimum tool for a human to use the protocol.
 *
 * Commands:
 *   upload <file>           Chunk + upload + announce → print asset_root URL
 *   fetch <cid> [-o file]   Resolve + download → write file
 *   fund <ref> <sats>       Fund any ref → POST /event kind=FUND
 *   post <ref> <text>       Threaded reply → POST /event kind=POST
 *   tip <cid> <sats>        Sign tip → credit bounty pool (legacy shim)
 *   keygen                  Generate Ed25519 keypair
 *   info <cid>              Query asset + bounty info
 *   hosts                   List registered hosts
 *   pin <asset_root>        Create pin contract
 *   pin status <pin_id>     Query pin status
 *   pin cancel <pin_id>     Cancel pin contract
 *   config                  Show/set CLI configuration
 *
 * DocRef: MVP_PLAN:§Bootstrap Sequence, §What Layer A Markets Need
 */

import { Command } from "commander";
import { loadConfig } from "./lib/config.js";
import { uploadCommand } from "./commands/upload.js";
import { fetchCommand } from "./commands/fetch.js";
import { tipCommand } from "./commands/tip.js";
import { fundCommand } from "./commands/fund.js";
import { postCommand } from "./commands/post.js";
import { keygenCommand } from "./commands/keygen.js";
import { infoCommand } from "./commands/info.js";
import { hostsCommand } from "./commands/hosts.js";
import { pinCreateCommand, pinStatusCommand, pinCancelCommand } from "./commands/pin.js";
import { configCommand } from "./commands/config-cmd.js";

const program = new Command();

program
  .name("dupenet")
  .description("Content availability via economic incentives")
  .version("0.0.1");

// ── upload ──────────────────────────────────────────────────────────

program
  .command("upload")
  .description("Upload a file or directory → announce → print asset_root (dir: + LIST event)")
  .argument("<path>", "File or directory to upload")
  .option("-g, --gateway <url>", "Gateway URL override")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .option("--title <title>", "Content title (default: filename)")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--access <mode>", "Access mode: open|paid (default: paid)")
  .option("--author-pubkey <hex>", "Author's Ed25519 pubkey (if different from uploader)")
  .option("--revshare <bps>", "Revenue share to author in basis points (0–10000)")
  .action(async (path: string, opts: { gateway?: string; coordinator?: string; title?: string; tags?: string; access?: string; authorPubkey?: string; revshare?: string }) => {
    const config = await loadConfig();
    if (opts.gateway) config.gateway = opts.gateway;
    if (opts.coordinator) config.coordinator = opts.coordinator;
    const revshare = opts.revshare ? parseInt(opts.revshare, 10) : undefined;
    if (revshare !== undefined && (isNaN(revshare) || revshare < 0 || revshare > 10000)) {
      throw new Error("--revshare must be 0–10000 basis points (100 = 1%)");
    }
    await uploadCommand(path, config, {
      title: opts.title,
      tags: opts.tags,
      access: opts.access,
      authorPubkey: opts.authorPubkey,
      revshare,
    });
  });

// ── fetch ───────────────────────────────────────────────────────────

program
  .command("fetch")
  .description("Fetch content by CID: resolve → download → verify → write")
  .argument("<cid>", "Asset root or block CID (64-char hex)")
  .option("-o, --output <file>", "Output file path")
  .option("--free", "Fail instead of paying L402 (for dev/free gateways)")
  .option("-g, --gateway <url>", "Gateway URL override")
  .action(async (cid: string, opts: { output?: string; free?: boolean; gateway?: string }) => {
    const config = await loadConfig();
    if (opts.gateway) config.gateway = opts.gateway;
    await fetchCommand(cid, config, { output: opts.output, free: opts.free });
  });

// ── tip ─────────────────────────────────────────────────────────────

program
  .command("tip")
  .description("Tip a CID: sign → POST /tip → print bounty balance")
  .argument("<cid>", "Asset root CID to tip (64-char hex)")
  .argument("<sats>", "Amount in sats")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (cid: string, sats: string, opts: { coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await tipCommand(cid, sats, config);
  });

// ── fund (EventV1 replacement for tip) ──────────────────────────────

program
  .command("fund")
  .description("Fund any ref: POST /event kind=FUND → credit pool")
  .argument("<ref>", "Pool key — CID, event_id, or topic hash (64-char hex)")
  .argument("<sats>", "Amount in sats")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (ref: string, sats: string, opts: { coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await fundCommand(ref, sats, config);
  });

// ── post (threaded comment) ─────────────────────────────────────────

program
  .command("post")
  .description("Post a threaded reply: POST /event kind=POST")
  .argument("<ref>", "Parent event_id or topic hash (64-char hex)")
  .argument("<text>", "Comment text (≤16 KiB)")
  .option("-s, --sats <n>", "Attach sats to boost this post", "0")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (ref: string, text: string, opts: { sats?: string; coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    const sats = parseInt(opts.sats ?? "0", 10);
    await postCommand(ref, text, config, { sats: isNaN(sats) ? 0 : sats });
  });

// ── keygen ──────────────────────────────────────────────────────────

program
  .command("keygen")
  .description("Generate Ed25519 keypair → ~/.dupenet/key.json")
  .option("--force", "Overwrite existing key file")
  .action(async (opts: { force?: boolean }) => {
    const config = await loadConfig();
    await keygenCommand(config, { force: opts.force });
  });

// ── info ────────────────────────────────────────────────────────────

program
  .command("info")
  .description("Query asset + bounty info for a CID")
  .argument("<cid>", "CID to query (64-char hex)")
  .option("-g, --gateway <url>", "Gateway URL override")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (cid: string, opts: { gateway?: string; coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.gateway) config.gateway = opts.gateway;
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await infoCommand(cid, config);
  });

// ── hosts ───────────────────────────────────────────────────────────

program
  .command("hosts")
  .description("List registered hosts from the directory")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (opts: { coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await hostsCommand(config);
  });

// ── pin ─────────────────────────────────────────────────────────────

const pinCmd = program
  .command("pin")
  .description("Pin contract management");

pinCmd
  .command("create")
  .description("Create a pin contract for an asset")
  .argument("<asset_root>", "Asset root CID (64-char hex)")
  .option("--budget <sats>", "Total budget in sats", "1000")
  .option("--duration <epochs>", "Duration in epochs", "100")
  .option("--copies <n>", "Minimum independent copies", "3")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (assetRoot: string, opts: { budget?: string; duration?: string; copies?: string; coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await pinCreateCommand(assetRoot, config, opts);
  });

pinCmd
  .command("status")
  .description("Query pin contract status")
  .argument("<pin_id>", "Pin contract ID")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (pinId: string, opts: { coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await pinStatusCommand(pinId, config);
  });

pinCmd
  .command("cancel")
  .description("Cancel a pin contract (returns remaining budget minus 5% fee)")
  .argument("<pin_id>", "Pin contract ID")
  .option("-c, --coordinator <url>", "Coordinator URL override")
  .action(async (pinId: string, opts: { coordinator?: string }) => {
    const config = await loadConfig();
    if (opts.coordinator) config.coordinator = opts.coordinator;
    await pinCancelCommand(pinId, config);
  });

// ── config ──────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show or update CLI configuration (multi-endpoint aware)")
  .option("-g, --gateway <url>", "Set primary gateway URL")
  .option("-c, --coordinator <url>", "Set primary coordinator URL")
  .option("--key-path <path>", "Set key file path")
  .option("--lnd-host <url>", "Set LND REST host")
  .action(async (opts: { gateway?: string; coordinator?: string; keyPath?: string; lndHost?: string }) => {
    await configCommand(opts);
  });

// ── Run ─────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
