#!/usr/bin/env node
/**
 * dupenet CLI — the minimum tool for a human to use the protocol.
 *
 * Commands:
 *   upload <file>           Chunk + upload → print asset_root URL
 *   fetch <cid> [-o file]   Resolve + download → write file
 *   tip <cid> <sats>        Sign tip → credit bounty pool
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
  .description("Upload a file: chunk → PUT blocks → PUT file → PUT asset → print URL")
  .argument("<file>", "Path to file to upload")
  .option("-g, --gateway <url>", "Gateway URL override")
  .action(async (file: string, opts: { gateway?: string }) => {
    const config = await loadConfig();
    if (opts.gateway) config.gateway = opts.gateway;
    await uploadCommand(file, config);
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
  .description("Show or update CLI configuration")
  .option("-g, --gateway <url>", "Set gateway URL")
  .option("-c, --coordinator <url>", "Set coordinator URL")
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
