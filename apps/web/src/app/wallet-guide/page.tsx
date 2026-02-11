/**
 * /wallet-guide — one-screen guide for users without a Lightning wallet.
 *
 * Minimal: link to Phoenix + Alby, explain QR scan flow, link back to content.
 * Accept bounce-and-return — user downloads wallet, comes back, scans QR.
 */

export const metadata = {
  title: "Get a Lightning Wallet — dupenet",
};

export default function WalletGuide() {
  return (
    <>
      <a href="/">{"\u25c0"}</a>
      <hr />

      <b>Get a Lightning Wallet</b>
      <br />
      <span className="t">
        To fund content on dupenet, you need a Lightning wallet.
        Setup takes ~2 minutes.
      </span>

      <hr />

      <b>1. Pick a wallet</b>
      <br /><br />

      <b>Phoenix</b>
      <span className="t"> — recommended, self-custodial</span>
      <br />
      <span className="t">
        Mobile (iOS / Android). No account needed. Auto-manages channels.
        You control your keys.
      </span>
      <br />
      <a href="https://phoenix.acinq.co/" target="_blank" rel="noopener">
        phoenix.acinq.co →
      </a>
      <br /><br />

      <b>Alby</b>
      <span className="t"> — browser extension, WebLN</span>
      <br />
      <span className="t">
        Chrome / Firefox / Brave. Enables one-click payments on dupenet
        (no QR needed — auto-pays). Connect your own node or use Alby Hub.
      </span>
      <br />
      <a href="https://getalby.com/" target="_blank" rel="noopener">
        getalby.com →
      </a>
      <br /><br />

      <b>Zeus</b>
      <span className="t"> — power users, self-custodial</span>
      <br />
      <span className="t">
        Mobile. Connect to your own LND/CLN node, or use the embedded node.
        Full control.
      </span>
      <br />
      <a href="https://zeusln.com/" target="_blank" rel="noopener">
        zeusln.com →
      </a>

      <hr />

      <b>2. Fund your wallet</b>
      <br />
      <span className="t">
        Most wallets let you buy sats directly or receive from another wallet.
        Phoenix: tap &quot;Receive&quot; and share invoice. Alby Hub: connect a funding
        source or deposit via on-chain.
      </span>

      <hr />

      <b>3. Come back and scan</b>
      <br />
      <span className="t">
        Return to dupenet, tap <b>+฿</b> on any content, pick an amount.
        Scan the QR code with your wallet or (if using Alby) it pays automatically.
        The content&apos;s preservation pool is credited within seconds.
      </span>

      <hr />

      <span className="t">
        Questions?{" "}
        <a href="https://github.com/dupenet" target="_blank" rel="noopener">
          github.com/dupenet
        </a>
      </span>
    </>
  );
}
