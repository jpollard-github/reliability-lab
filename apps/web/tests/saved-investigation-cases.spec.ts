import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seedCases } from "./support/cases";
import { createComparison } from "./support/comparisons";
import {
  createFallbackExecution,
  createRetryExecution,
  waitForExecution,
} from "./support/executions";
import { resolvedTestRange } from "./support/ranges";
import { apiBaseUrl, tenantHeaders } from "./support/api";

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
  await expect(
    page.getByLabel("Manage evidence links").getByText(retry.executionId, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence review" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conclusion readiness" })).toBeVisible();
  await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Current finding is present")).toBeVisible();

  await page.getByLabel("Status").selectOption("resolved");
  await page.getByRole("button", { name: "Update case" }).click();
  await expect(
    page.getByText("Resolved cases require a non-empty current finding and resolution"),
  ).toBeVisible();

  await page.getByLabel("Evidence type").selectOption("comparison");
  await page.getByLabel("Execution or comparison ID").fill(comparison.experiment.experimentId);
  await page.getByRole("button", { name: "Add evidence" }).click();
  await expect(
    page
      .getByLabel("Manage evidence links")
      .getByText(comparison.experiment.experimentId, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Evidence type").selectOption("provider_observation");
  const evidenceForm = page.getByRole("heading", { name: "Add evidence reference" }).locator("..");
  await evidenceForm.getByLabel("Provider", { exact: true }).fill("fake-primary");
  await evidenceForm.getByLabel("Model", { exact: true }).fill("deterministic-v1");
  await page.getByRole("button", { name: "Add evidence" }).click();
  await expect(
    page.getByText("fake-primary / deterministic-v1", { exact: true }).first(),
  ).toBeVisible();

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
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The required case record is complete enough to resolve."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review packet" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^reliability-case-.+\.md$/u);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const packet = await readFile(downloadedPath!, "utf8");
  expect(packet).toContain(`# Reliability case: ${caseTitle}`);
  expect(packet).toContain("Bounded retry recovered the selected execution\\.");
  expect(packet).toContain("Keep the bounded retry policy\\.");
  expect(packet).toContain("fake\\-primary/deterministic\\-v1");
  expect(packet).not.toContain("Saved case retry evidence");
  expect(packet).not.toContain("Retry recovered on the second attempt.");

  await page.getByRole("link", { name: "Open saved workbench scope" }).click();
  await expect(page).toHaveURL(/from=/);
  await expect(page).toHaveURL(/to=/);
  await expect(page).toHaveURL(/signal=retry_recovered/);
  await expect(page.getByLabel("Signal")).toHaveValue("retry_recovered");

  await page.goto(caseUrl);
  const tourUrl = page.url();
  await page.getByRole("button", { name: "Tour this page" }).click();
  const tour = page.getByRole("dialog", { name: "Investigation case detail tour" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Run a controlled experiment" })).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Evidence review and readiness" })).toBeVisible();
  await expect(page).toHaveURL(tourUrl);
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  await expect(page).toHaveURL(tourUrl);

  await page
    .locator(".case-review-list > li")
    .filter({
      has: page
        .locator(".case-review-item-heading strong")
        .getByText(retry.executionId, { exact: true }),
    })
    .getByRole("link", { name: "Open authoritative source" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/executions/${retry.executionId}$`));
  await expect(page.getByText("Trace ID (copyable)")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(caseUrl);
  await expect(page.getByRole("heading", { name: "Evidence review" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const seeds = await seedCases(request, 26, resolvedTestRange());
  expect(seeds.every((response) => response.status() === 201)).toBe(true);

  await page.goto(`/investigation-cases?status=resolved&q=${encodeURIComponent(caseTitle)}`);
  await expect(page.getByRole("link", { name: caseTitle })).toBeVisible();
  await page.goto("/investigation-cases");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByRole("link", { name: "First page" })).toBeVisible();
});

test("keeps case evidence review and readiness readable without JavaScript", async ({
  browser,
  request,
}) => {
  const execution = await createRetryExecution(
    request,
    "No-JavaScript review secret input",
    "case-review-no-js",
  );
  expect(execution.response.status()).toBe(202);
  await waitForExecution(request, execution.executionId, "succeeded");
  const range = resolvedTestRange();
  const created = await request.post(`${apiBaseUrl}/v1/investigation-cases`, {
    headers: tenantHeaders,
    data: {
      title: `No-JavaScript case ${Date.now()}`,
      question: "Can the bounded review be read without client JavaScript?",
      savedScope: { range },
    },
  });
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { case: { caseId: string } };
  const caseId = createdBody.case.caseId;
  const linked = await request.post(`${apiBaseUrl}/v1/investigation-cases/${caseId}/evidence`, {
    headers: tenantHeaders,
    data: { type: "execution", executionId: execution.executionId },
  });
  expect(linked.status()).toBe(200);
  const comparison = await createComparison(request, execution.executionId);
  expect(comparison.response.status()).toBe(202);
  if (comparison.experiment.variantExecutionId) {
    await waitForExecution(request, comparison.experiment.variantExecutionId, "degraded");
  }
  const comparisonLinked = await request.post(
    `${apiBaseUrl}/v1/investigation-cases/${caseId}/evidence`,
    {
      headers: tenantHeaders,
      data: { type: "comparison", experimentId: comparison.experiment.experimentId },
    },
  );
  expect(comparisonLinked.status()).toBe(200);

  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  try {
    await page.goto(`/investigation-cases/${caseId}`);
    await expect(page.getByRole("heading", { name: "Run controlled experiment" })).toBeVisible();
    await expect(page.getByText("Replay available: Replay capsule is available")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conclusion readiness" })).toBeVisible();
    await expect(page.getByText(execution.executionId, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(comparison.experiment.experimentId, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Current finding is present")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download review packet" })).toBeVisible();
  } finally {
    await context.close();
  }
});
