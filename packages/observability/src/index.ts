import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ExecutionTracer } from "@reliability-lab/core";

export class OpenTelemetryExecutionTracer implements ExecutionTracer {
  readonly #tracer = trace.getTracer("reliability-lab");
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number>,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.#tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await run();
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error("Unknown span error"));
        throw error;
      } finally {
        span.end();
      }
    });
  }
}

export function startTelemetry(options: { serviceName: string; otlpEndpoint?: string }) {
  const exporter = options.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${options.otlpEndpoint.replace(/\/$/, "")}/v1/traces` })
    : new ConsoleSpanExporter();
  const sdk = new NodeSDK({
    serviceName: options.serviceName,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  sdk.start();
  return sdk;
}

export const pinoRedactionPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "apiKey",
  "OPENAI_API_KEY",
  "*.apiKey",
  "*.authorization",
  "*.messages",
  "*.input",
];
