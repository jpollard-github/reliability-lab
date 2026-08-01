import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export function createReplayKeySetup(random = randomBytes) {
  const key = random(32).toString("base64");
  const version = "local-v1";
  return [
    "Replay Vault key generated. Treat the base64 value as a secret.",
    "Store it only in an ignored local environment file or deployment secret manager; this command writes no files.",
    "",
    "REPLAY_CAPSULE_STORE=postgres",
    "ALLOW_LIVE_PROMPT_RETENTION=true",
    "REPLAY_CAPSULE_RETENTION_HOURS=24",
    `REPLAY_CAPSULE_ACTIVE_KEY_VERSION=${version}`,
    `REPLAY_CAPSULE_KEYS_JSON={"${version}":"${key}"}`,
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(createReplayKeySetup());
}
