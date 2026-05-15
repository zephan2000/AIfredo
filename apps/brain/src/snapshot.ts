import { spawn } from "node:child_process";

// CLI credential snapshot to GCS. Claude/Codex rotate their refresh tokens on
// every run; the 6h cron alone leaves a wide window where the GCS snapshot
// holds a spent token and a VM replacement restores garbage. Snapshotting
// right after each successful run keeps the snapshot at most ~30s stale.
//
// 30s coalesce, trailing: the snapshot is never more than 30s behind the most
// recent run, but a rapid back-and-forth chat doesn't stack uploads. Idle ⇒
// no runs ⇒ no rotation ⇒ snapshot stays valid (the 6h cron is the floor).

const COALESCE_MS = 30_000;
const SNAPSHOT_CMD = "/opt/AIfredo/snapshot-creds.sh";

let lastFiredAt = 0;
let pending: NodeJS.Timeout | null = null;

function fire(): void {
  lastFiredAt = Date.now();
  try {
    const child = spawn("sudo", [SNAPSHOT_CMD], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => console.error("snapshot spawn failed:", err));
    child.unref();
  } catch (err) {
    console.error("snapshot trigger failed:", err);
  }
}

export function snapshotCredsAfterRun(): void {
  const since = Date.now() - lastFiredAt;
  if (since >= COALESCE_MS) {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    fire();
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      fire();
    }, COALESCE_MS - since);
    pending.unref();
  }
}
