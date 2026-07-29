import { expect, test } from "@playwright/test";
import { seedCases } from "./support/cases";
import { createComparison } from "./support/comparisons";
import {
  createFallbackExecution,
  createRetryExecution,
  waitForExecution,
} from "./support/executions";
import { resolvedTestRange } from "./support/ranges";

test("saves a complete investigation case and reopens its exact evidence scope", async ({
  page,
  request,
}) => {
  test.slow();
  const caseTitle = `Retry recovery case ${Date.now()}`;
  const retry = await createRetryExecution(request, "Saved case retry evidence", "case-retry");
  const fallback = await createFallbackExecution(
    request,
    "Saved case fallback evidence",
    "case-fallback",
  );
  expect(retry.response.status()).toBe(202);
  expect(fallback.response.status()).toBe(202);
  await Promise.all([
    waitForExecution(request, retry.executionId, "succeeded"),
    waitForExecution(request, fallback.executionId, "degraded"),
  ]);

  const comparison = await createComparison(request, retry.executionId);
  expect(comparison.response.status()).toBe(202);
  if (comparison.experiment.variantExecutionId) {
    await waitForExecution(request, comparison.experiment.variantExecutionId, "degraded");
  }

  await page.goto("/investigations?window=24h&signal=retry_recovered");
  await expect(page.getByRole("heading", { name: "Save investigation" })).toBeVisible();
  await page.getByLabel("Case title").fill(caseTitle);
  await page.getByLabel("Reliability question").fill("Did bounded retry recover this window?");
  await page.getByLabel(retry.executionId.slice(0, 12)).check();
  await page.getByRole("button", { name: "Save investigation" }).click();

  await expect(page).toHaveURL(/\/investigation-cases\/[^/?]+$/);
  const caseUrl = page.url();
  await expect(page.getByRole("heading", { name: caseTitle })).toBeVisible();
  await expect(page.getByText(/Actor identity is unavailable/i)).toBeVisible();
  await expect(page.getByText(retry.executionId, { exact: true })).toBeVisible();

  await page.getByLabel("Evidence type").selectOption("comparison");
  await page.getByLabel("Execution or comparison ID").fill(comparison.experiment.experimentId);
  await page.getByRole("button", { name: "Add evidence" }).click();
  await expect(page.getByText(comparison.experiment.experimentId, { exact: true })).toBeVisible();

  await page.getByLabel("Note", { exact: true }).fill("Retry recovered on the second attempt.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Retry recovered on the second attempt.")).toBeVisible();

  await page.getByLabel("Current finding").fill("Bounded retry recovered the selected execution.");
  await page.getByLabel("Resolution").fill("Keep the bounded retry policy.");
  await page.getByLabel("Status").selectOption("resolved");
  await page.getByRole("button", { name: "Update case" }).click();
  await expect(page.getByText("resolved", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({
      hasText: "Bounded retry recovered the selected execution.",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open saved workbench scope" }).click();
  await expect(page).toHaveURL(/from=/);
  await expect(page).toHaveURL(/to=/);
  await expect(page).toHaveURL(/signal=retry_recovered/);
  await expect(page.getByLabel("Signal")).toHaveValue("retry_recovered");

  await page.goto(caseUrl);
  await page
    .getByRole("listitem")
    .filter({ hasText: retry.executionId })
    .getByRole("link", { name: "Open evidence" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/executions/${retry.executionId}$`));
  await expect(page.getByText("Trace ID (copyable)")).toBeVisible();

  const seeds = await seedCases(request, 26, resolvedTestRange());
  expect(seeds.every((response) => response.status() === 201)).toBe(true);

  await page.goto(`/investigation-cases?status=resolved&q=${encodeURIComponent(caseTitle)}`);
  await expect(page.getByRole("link", { name: caseTitle })).toBeVisible();
  await page.goto("/investigation-cases");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByRole("link", { name: "First page" })).toBeVisible();
});
