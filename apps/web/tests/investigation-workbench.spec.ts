import { expect, test } from "@playwright/test";
import {
  createExecution,
  createFallbackExecution,
  createRetryExecution,
  seedExecutions,
  waitForExecution,
} from "./support/executions";

test("investigates executions with drill-downs and preserves return context", async ({
  page,
  request,
}) => {
  const created = await createExecution(
    request,
    {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Investigation workbench smoke execution",
    },
    "investigation",
  );
  const retry = await createRetryExecution(request, "Investigation retry evidence");
  const fallback = await createFallbackExecution(request, "Investigation fallback evidence");
  expect(created.response.status()).toBe(202);
  expect(retry.response.status()).toBe(202);
  expect(fallback.response.status()).toBe(202);
  await Promise.all([
    waitForExecution(request, created.executionId, "succeeded"),
    waitForExecution(request, retry.executionId, "succeeded"),
    waitForExecution(request, fallback.executionId, "degraded"),
  ]);

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
  await page.getByLabel("Execution or trace prefix").fill(created.traceId!);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=/);
  await page.getByRole("link", { name: created.executionId.slice(0, 12), exact: true }).click();
  await expect(page.getByRole("link", { name: "Investigation results" })).toBeVisible();
  await expect(page.getByText("Trace ID (copyable)")).toBeVisible();
  await page.getByRole("link", { name: "Investigation results" }).click();
  await expect(page.getByLabel("Execution or trace prefix")).toHaveValue(created.traceId!);
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
  const submissions = await seedExecutions(request, 26);
  expect(submissions.every(({ response }) => response.status() === 202)).toBe(true);

  await page.goto("/investigations?window=24h&provider=fake-primary&model=deterministic-v1");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByRole("link", { name: "First page" })).toBeVisible();

  await Promise.all(
    submissions.map(({ executionId }) => waitForExecution(request, executionId, "succeeded")),
  );
});
