import { runBuiltApiProviderProof } from "./provider-proof-runtime.mjs";

if (process.env.RUN_LIVE_PROVIDER_VERIFY !== "true") {
  process.stdout.write(
    "External live provider proof: not run (RUN_LIVE_PROVIDER_VERIFY is not true; no request was made).\n",
  );
  process.exit(0);
}

const providerBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim();
if (!providerBaseUrl || !apiKey || !model) {
  process.stdout.write(
    "External live provider proof: not run (URL, key, and model configuration are incomplete; no request was made).\n",
  );
  process.exit(0);
}

try {
  const result = await runBuiltApiProviderProof({
    providerBaseUrl,
    apiKey,
    model,
    timeoutMs: 20_000,
    input: (identity) =>
      `Reliability Lab live provider proof ${identity}. Reply with LIVE_PROVIDER_PROOF_OK.`,
  });
  process.stdout.write(
    `External live provider proof: passed (provider ${result.providerId}, model ${result.modelLabel}, status ${result.status}, attempts ${result.attemptCount}, replay ${result.replayState}). Replay verification was not run.\n`,
  );
} catch {
  process.stderr.write(
    "External live provider proof: failed safely. No provider response body, request input, endpoint, or credential was printed.\n",
  );
  process.exitCode = 1;
}
