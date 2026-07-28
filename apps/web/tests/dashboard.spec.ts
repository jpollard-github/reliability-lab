import { expect, test, type APIRequestContext } from "@playwright/test";

test("shows durable queue and worker evidence before terminal completion", async ({
  page,
  request,
}) => {
  const create = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: { "x-tenant-id": "demo-tenant" },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Durable Playwright execution",
    },
  });
  expect(create.status()).toBe(202);
  const body = (await create.json()) as { executionId: string; status: string };
  expect(body.status).toBe("queued");

  await page.goto(`/executions/${body.executionId}`);
  await expect(page.getByText("Execution queued", { exact: true })).toBeVisible();
  await expect(page.getByText("Worker claimed execution", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
});

test("lists an execution and opens its event timeline", async ({ page, request }) => {
  const create = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: {
      "x-tenant-id": "demo-tenant",
      "idempotency-key": `playwright-${Date.now()}`,
    },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Playwright smoke execution",
    },
  });
  expect(create.ok()).toBeTruthy();
  const body = (await create.json()) as { executionId: string };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reliability executions" })).toBeVisible();
  await page.getByRole("link", { name: body.executionId.slice(0, 12), exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live execution machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event timeline" })).toBeVisible();
  await expect(page.getByText("execution · succeeded")).toBeVisible();
  await expect(page.getByTitle("Replay capsule is available")).toBeVisible();

  await page.getByRole("button", { name: "Play event history" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText(/Step \d+ of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Step" }).click();
  await page.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Live edge" }).click();
  await expect(page.getByText("Recorded history", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete replay data" }).click();
  await expect(page.getByTitle("Replay capsule was deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay execution" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Compare with variant" })).toBeDisabled();
});

test("shows a real retry transition from durable event evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();

  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Live execution machine" })).toBeVisible();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("1500 ms real backoff", { exact: false })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(page.getByText("Stream complete", { exact: true })).toBeVisible();
});

test("compares a retrying execution with an immediate-fallback variant", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();

  const compare = page.getByRole("button", { name: "Compare with variant" });
  await expect(compare).toBeEnabled();
  await compare.click();
  await page.getByLabel("Comparison preset").selectOption("fallback");
  await page.getByRole("button", { name: "Create comparison" }).click();

  await expect(page).toHaveURL(/\/comparisons\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Original machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Variant machine" })).toBeVisible();
  await expect(page.getByText(/no universal winner/i)).toBeVisible();

  const retries = page.getByRole("row").filter({ hasText: "Retries" });
  await expect(retries).toContainText("1");
  await expect(retries).toContainText("0");
  await expect(retries).toContainText("improved");

  await page.getByRole("button", { name: "Play event history" }).first().click();
  await expect(page.getByText(/Step \d+ of \d+/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Original detail" })).toHaveAttribute(
    "href",
    /\/executions\//,
  );
  await expect(page.getByRole("link", { name: "Variant detail" })).toHaveAttribute(
    "href",
    /\/executions\//,
  );
});

test("investigates executions with drill-downs and preserves return context", async ({
  page,
  request,
}) => {
  const create = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: {
      "x-tenant-id": "demo-tenant",
      "idempotency-key": `investigation-${Date.now()}`,
    },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Investigation workbench smoke execution",
    },
  });
  expect(create.status()).toBe(202);
  const body = (await create.json()) as { executionId: string; traceId: string };
  const retryCreate = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: { "x-tenant-id": "demo-tenant" },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Investigation retry evidence",
      failureMode: "rate_limit",
      policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
    },
  });
  const retry = (await retryCreate.json()) as { executionId: string };
  const fallbackCreate = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: { "x-tenant-id": "demo-tenant" },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Investigation fallback evidence",
      failureMode: "provider_error",
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    },
  });
  const fallback = (await fallbackCreate.json()) as { executionId: string };
  await waitForExecution(request, body.executionId, "succeeded");
  await waitForExecution(request, retry.executionId, "succeeded");
  await waitForExecution(request, fallback.executionId, "degraded");

  await page.goto("/investigations?window=24h");
  await expect(page.getByRole("heading", { name: "Investigation workbench" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outcome trend" })).toBeVisible();
  await expect(page.getByText(/no universal score/i)).toBeVisible();
  await page.getByRole("link", { name: "fake-primary / deterministic-v1" }).click();
  await expect(page).toHaveURL(/provider=fake-primary/);
  await expect(page).toHaveURL(/model=deterministic-v1/);
  await page.goto("/investigations?window=24h");

  await page.getByText("Retry recovered", { exact: true }).click();
  await expect(page).toHaveURL(/signal=retry_recovered/);
  await expect(
    page.getByRole("link", { name: retry.executionId.slice(0, 12), exact: true }),
  ).toBeVisible();
  await page.getByText("Fallback dependent", { exact: true }).click();
  await expect(page).toHaveURL(/signal=fallback_used/);
  await expect(
    page.getByRole("link", { name: fallback.executionId.slice(0, 12), exact: true }),
  ).toBeVisible();

  await page.goto("/investigations?window=24h");
  await page.getByLabel("Execution or trace prefix").fill(body.traceId);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=/);
  await page.getByRole("link", { name: body.executionId.slice(0, 12), exact: true }).click();
  await expect(page.getByRole("link", { name: "Investigation results" })).toBeVisible();
  await expect(page.getByText("Trace ID (copyable)")).toBeVisible();
  await page.getByRole("link", { name: "Investigation results" }).click();
  await expect(page.getByLabel("Execution or trace prefix")).toHaveValue(body.traceId);
});

test("shows accessible empty evidence states for a bounded custom window", async ({ page }) => {
  await page.goto(
    "/investigations?from=2030-01-01T00%3A00%3A00.000Z&to=2030-01-02T00%3A00%3A00.000Z",
  );
  await expect(page.getByText("No executions were recorded in this time window.")).toBeVisible();
  await expect(
    page.getByText("No attempt-level provider evidence exists in this window."),
  ).toBeVisible();
  await expect(page.getByText("No executions recorded for demo-tenant.")).toBeVisible();
});

test("navigates a stable cursor page from a seeded execution set", async ({ page, request }) => {
  const submissions = await Promise.all(
    Array.from({ length: 26 }, (_, index) =>
      request.post("http://127.0.0.1:4000/v1/executions", {
        headers: {
          "x-tenant-id": "demo-tenant",
          "idempotency-key": `pagination-${Date.now()}-${index}`,
        },
        data: {
          provider: "fake-primary",
          model: "deterministic-v1",
          input: `Pagination evidence ${index}`,
        },
      }),
    ),
  );
  expect(submissions.every((response) => response.status() === 202)).toBe(true);
  const executionIds = await Promise.all(
    submissions.map(
      async (response) => ((await response.json()) as { executionId: string }).executionId,
    ),
  );

  await page.goto("/investigations?window=24h&provider=fake-primary&model=deterministic-v1");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByRole("link", { name: "First page" })).toBeVisible();
  await expect
    .poll(async () => {
      const statuses = await Promise.all(
        executionIds.map(async (executionId) => {
          const response = await request.get(`http://127.0.0.1:4000/v1/executions/${executionId}`, {
            headers: { "x-tenant-id": "demo-tenant" },
          });
          return ((await response.json()) as { status: string }).status;
        }),
      );
      return statuses.filter((status) => status === "succeeded").length;
    })
    .toBe(executionIds.length);
});

async function waitForExecution(request: APIRequestContext, executionId: string, status: string) {
  await expect
    .poll(async () => {
      const response = await request.get(`http://127.0.0.1:4000/v1/executions/${executionId}`, {
        headers: { "x-tenant-id": "demo-tenant" },
      });
      return ((await response.json()) as { status: string }).status;
    })
    .toBe(status);
}
