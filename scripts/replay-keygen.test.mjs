import { describe, expect, it } from "vitest";
import { createReplayKeySetup } from "./replay-keygen.mjs";

describe("Replay Vault key generation", () => {
  it("prints a 32-byte base64 key and complete fake local settings without writing files", () => {
    const output = createReplayKeySetup(() => Buffer.alloc(32, 7));
    const encoded = Buffer.alloc(32, 7).toString("base64");
    expect(Buffer.from(encoded, "base64")).toHaveLength(32);
    expect(output).toContain(`REPLAY_CAPSULE_KEYS_JSON={"local-v1":"${encoded}"}`);
    expect(output).toContain("REPLAY_CAPSULE_STORE=postgres");
    expect(output).toContain("ALLOW_LIVE_PROMPT_RETENTION=true");
    expect(output).toContain("REPLAY_CAPSULE_RETENTION_HOURS=24");
    expect(output).toContain("writes no files");
  });
});
