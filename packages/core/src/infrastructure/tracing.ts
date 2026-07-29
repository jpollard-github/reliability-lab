/** Domain tracing port. Span attributes must remain metadata-only. */
export interface ExecutionTracer {
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number>,
    run: () => Promise<T>,
  ): Promise<T>;
}

export const noOpTracer: ExecutionTracer = {
  withSpan: async (_name, _attributes, run) => run(),
};
