import { runLiveReplayVerifier } from "./live-replay-verifier.mjs";
import { runBuiltApiLiveReplayProof } from "./provider-proof-runtime.mjs";

process.exitCode = await runLiveReplayVerifier({
  environment: process.env,
  runProof: runBuiltApiLiveReplayProof,
  writeOutput: (message) => process.stdout.write(message),
  writeError: (message) => process.stderr.write(message),
});
