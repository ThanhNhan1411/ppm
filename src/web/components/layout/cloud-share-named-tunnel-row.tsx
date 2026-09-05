import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { namedTunnelApi, type NamedTunnelStatus } from "@/lib/api-named-tunnel";

interface Props {
  /** Called whenever the named-tunnel status is (re)loaded so the parent can adapt its copy. */
  onStatus: (status: NamedTunnelStatus) => void;
  /** Called while a mode switch settles so the parent can refetch the public URL. */
  onTunnelChanged: () => void;
}

/**
 * Compact named-tunnel control for the share popover: turn the custom domain
 * off (back to a temporary link) or back on when one was configured before.
 * First-time setup deliberately stays in the first-run popup / Tunnel Manager —
 * it needs the zone + hostname flow, which does not fit a share card.
 */
export function CloudShareNamedTunnelRow({ onStatus, onTunnelChanged }: Props) {
  const [status, setStatus] = useState<NamedTunnelStatus | null>(null);
  const [busy, setBusy] = useState<"off" | "on" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await namedTunnelApi.status();
      setStatus(s);
      onStatus(s);
    } catch { /* popover degrades to plain share card */ }
  }, [onStatus]);

  useEffect(() => { void load(); }, [load]);

  // The supervisor applies a mode switch asynchronously (retunnel → new connector →
  // status.json). Poll briefly so the card catches up instead of showing the
  // previous URL until the user reopens it.
  const settle = useCallback(async (want: "quick" | "named") => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await namedTunnelApi.status().catch(() => null);
      if (s) { setStatus(s); onStatus(s); }
      onTunnelChanged();
      if (s?.liveMode === want) break;
    }
  }, [onStatus, onTunnelChanged]);

  const turnOff = useCallback(async () => {
    setBusy("off"); setError(null);
    try { await namedTunnelApi.disable(); await settle("quick"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not switch to a temporary link"); }
    finally { setBusy(null); }
  }, [settle]);

  const turnOn = useCallback(async () => {
    if (!status?.hostname) return;
    setBusy("on"); setError(null);
    try { await namedTunnelApi.setup(status.hostname); await settle("named"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not re-enable the custom domain"); }
    finally { setBusy(null); }
  }, [status?.hostname, settle]);

  if (!status || status.authEnabled === false || !status.hostname) return null;
  const live = status.liveMode ?? status.mode;
  const canReenable = live !== "named" && status.certState === "ok";
  if (live !== "named" && !canReenable) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <Globe className="size-3 text-primary shrink-0" />
          <span className="text-foreground truncate">
            {live === "named" ? "Your domain" : "Domain configured"} · {status.hostname}
          </span>
        </div>
        <button
          onClick={live === "named" ? turnOff : turnOn}
          disabled={busy !== null}
          className="shrink-0 min-h-11 px-2.5 text-xs rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
          title={live === "named" ? "Switch back to a temporary link" : "Switch back to your domain"}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : live === "named" ? "Use temporary link" : "Use my domain"}
        </button>
      </div>
      {status.tunnelWarning && (
        <p className="text-[11px] text-amber-500 leading-relaxed">{status.tunnelWarning}</p>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
