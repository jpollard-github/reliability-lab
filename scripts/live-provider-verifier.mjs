const requiredSettings = ["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"];
const safeLabel = /^[A-Za-z0-9._:/-]{1,128}$/u;

/**
 * Owns external-proof opt-in, success semantics, and metadata-only operator output.
 */
export async function runLiveProviderVerifier({ environment, runProof, writeOutput, writeError }) {
  if (environment.RUN_LIVE_PROVIDER_VERIFY !== "true") {
    writeOutput(
      "External live provider proof: not run (RUN_LIVE_PROVIDER_VERIFY is not true; no request was made).\n",
    );
    return 0;
  }

  const missingSettings = requiredSettings.filter((name) => !environment[name]?.trim());
  if (missingSettings.length > 0) {
    writeError(
      `External live provider proof: not run; missing required settings: ${missingSettings.join(", ")}. No request was made.\n`,
    );
    return 1;
  }

  try {
    const result = validateProofResult(
      await runProof({
        providerBaseUrl: environment.OPENAI_COMPATIBLE_BASE_URL.trim(),
        apiKey: environment.OPENAI_API_KEY.trim(),
        model: environment.OPENAI_MODEL.trim(),
        timeoutMs: 20_000,
        input: (identity) =>
          `Reliability Lab live provider proof ${identity}. Reply with LIVE_PROVIDER_PROOF_OK.`,
      }),
    );

    writeOutput(`External live provider proof: succeeded (${formatMetadata(result)}).\n`);
    writeOutput(
      "This proves one bounded connectivity/execution path only; it does not establish provider reliability, model quality, factual correctness, or production readiness.\n",
    );
    return 0;
  } catch {
    writeError(
      "External live provider proof: failed safely; no provider response body, request input, endpoint, or credential was printed.\n",
    );
    return 1;
  }
}

function validateProofResult(value) {
  if (!value || typeof value !== "object") throw new Error("Malformed proof result");
  if (
    typeof value.providerId !== "string" ||
    typeof value.modelLabel !== "string" ||
    !safeLabel.test(value.providerId) ||
    !safeLabel.test(value.modelLabel)
  ) {
    throw new Error("Unsafe proof metadata");
  }
  if (value.status !== "succeeded") throw new Error("Execution did not succeed");
  if (value.externalRequestCount !== 1) throw new Error("Unexpected external request count");

  return {
    providerId: value.providerId,
    modelLabel: value.modelLabel,
    status: value.status,
    externalRequestCount: value.externalRequestCount,
    ...optionalBoundedNumber(value, "totalLatencyMs", false),
    ...optionalBoundedNumber(value, "providerLatencyMs", false),
    ...optionalBoundedNumber(value, "inputTokens", true),
    ...optionalBoundedNumber(value, "outputTokens", true),
    ...optionalBoundedNumber(value, "totalTokens", true),
  };
}

function optionalBoundedNumber(value, key, integer) {
  if (value[key] === undefined) return {};
  if (
    typeof value[key] !== "number" ||
    !Number.isFinite(value[key]) ||
    value[key] < 0 ||
    value[key] > 1_000_000_000 ||
    (integer && !Number.isInteger(value[key]))
  ) {
    throw new Error("Malformed proof metric");
  }
  return { [key]: value[key] };
}

function formatMetadata(result) {
  const fields = [
    ["providerId", result.providerId],
    ["model", result.modelLabel],
    ["status", result.status],
    ["totalLatencyMs", result.totalLatencyMs],
    ["providerLatencyMs", result.providerLatencyMs],
    ["inputTokens", result.inputTokens],
    ["outputTokens", result.outputTokens],
    ["totalTokens", result.totalTokens],
    ["externalRequestCount", result.externalRequestCount],
  ];
  return fields
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
}
