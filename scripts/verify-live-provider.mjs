import { runBuiltApiProviderProof } from "./provider-proof-runtime.mjs";
import { runLiveProviderVerifier } from "./live-provider-verifier.mjs";

process.exitCode = await runLiveProviderVerifier({
  environment: process.env,
  runProof: runBuiltApiProviderProof,
  writeOutput: (message) => process.stdout.write(message),
  writeError: (message) => process.stderr.write(message),
});
