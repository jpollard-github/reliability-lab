import { expect, test, type APIRequestContext, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { apiBaseUrl, tenantHeaders } from "./support/api";
import { createRetryExecution, waitForExecution } from "./support/executions";
import { resolvedTestRange } from "./support/ranges";

test("runs a case-driven comparison and recovers a forced partial link without duplication", async ({
  page,
  request,
}) => {
  test.slow();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (failed) => {
    const errorText = failed.failure()?.errorText ?? "";
    if (
      errorText === "net::ERR_ABORTED" &&
      /\/v1\/executions\/[^/]+\/events\?/u.test(failed.url())
    ) {
      return;
    }
    failedRequests.push(`${failed.method()} ${failed.url()} ${errorText}`);
  });

  const execution = await createRetryExecution(
    request,
    "Case-driven experiment retained input",
    "case-experiment",
  );
  expect(execution.response.status()).toBe(202);
  await waitForExecution(request, execution.executionId, "succeeded");
  const firstCase = await createCaseWithExecution(
    request,
    execution.executionId,
    `Policy experiment ${Date.now()}`,
  );

  const comparisonRoute = `**/v1/investigation-cases/${firstCase.caseId}/comparisons`;
  let normalCreateRequests = 0;
  const delayCreate = async (route: Route) => {
    normalCreateRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  };
  await page.route(comparisonRoute, delayCreate);

  await page.goto(`/investigation-cases/${firstCase.caseId}`);
  await expect(page.getByRole("heading", { name: "Run controlled experiment" })).toBeVisible();
  await expect(page.getByText(execution.executionId, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Replay available: Replay capsule is available")).toBeVisible();
  await page.getByLabel("Comparison preset").selectOption("fallback");

  const start = page.getByRole("button", { name: "Start controlled comparison" });
  await start.click();
  await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
  await expect(page.getByText("Comparison created and linked to this case.")).toBeVisible();
  expect(normalCreateRequests).toBe(1);

  const comparisonLink = page.getByRole("link", { name: "Open comparison" });
  const comparisonHref = await comparisonLink.getAttribute("href");
  expect(comparisonHref).toMatch(/^\/comparisons\/[^/]+$/u);
  const experimentId = comparisonHref!.split("/").at(-1)!;
  const comparison = await waitForComparison(request, experimentId);
  expect(comparison.experiment.originalExecutionId).toBe(execution.executionId);
  expect(comparison.experiment.variantExecutionId).toBeTruthy();
  await waitForExecution(request, comparison.experiment.variantExecutionId!, "degraded");

  await comparisonLink.click();
  await expect(page).toHaveURL(new RegExp(`/comparisons/${experimentId}$`, "u"));
  await expect(page.getByRole("heading", { name: "Original machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Variant machine" })).toBeVisible();
  await expect(page.getByText(/no universal winner/iu)).toBeVisible();

  await page.goto(`/investigation-cases/${firstCase.caseId}`);
  await expect(
    page.locator(".case-review-item-heading").getByText(experimentId, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("case comparison_started")).toBeVisible();
  await page.getByLabel("Current finding").fill("Immediate fallback changed the recorded route.");
  await page.getByLabel("Resolution").fill("Preserve the comparison for human policy review.");
  await page.getByLabel("Status").selectOption("resolved");
  await page.getByRole("button", { name: "Update case" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review packet" }).click();
  const download = await downloadPromise;
  const packetPath = await download.path();
  expect(packetPath).not.toBeNull();
  expect(await readFile(packetPath!, "utf8")).toContain(experimentId);

  const comparisonCountBeforeTour = normalCreateRequests;
  await page.getByRole("button", { name: "Tour this page" }).click();
  const tour = page.getByRole("dialog", { name: "Investigation case detail tour" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Run a controlled experiment" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  expect(normalCreateRequests).toBe(comparisonCountBeforeTour);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run controlled experiment" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");

  await page.unroute(comparisonRoute, delayCreate);
  await page.setViewportSize({ width: 1280, height: 900 });
  const partialCase = await createCaseWithExecution(
    request,
    execution.executionId,
    `Partial policy experiment ${Date.now()}`,
  );
  const partialRoute = `**/v1/investigation-cases/${partialCase.caseId}/comparisons`;
  let partialCreateRequests = 0;
  await page.route(partialRoute, async (route) => {
    partialCreateRequests += 1;
    const submitted = route.request().postDataJSON() as { variation: Record<string, unknown> };
    const created = await request.post(
      `${apiBaseUrl}/v1/executions/${execution.executionId}/comparisons`,
      {
        headers: tenantHeaders,
        data: { variation: submitted.variation },
      },
    );
    expect(created.status()).toBe(202);
    const body = (await created.json()) as {
      experiment: {
        experimentId: string;
        originalExecutionId: string;
        variantExecutionId?: string;
      };
    };
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          kind: "comparison_created_link_failed",
          experiment: body.experiment,
          recovery: {
            kind: "link_existing_comparison",
            experimentId: body.experiment.experimentId,
          },
        },
        links: {
          case: `/v1/investigation-cases/${partialCase.caseId}`,
          comparison: `/v1/comparisons/${body.experiment.experimentId}`,
          originalExecution: `/v1/executions/${body.experiment.originalExecutionId}`,
          ...(body.experiment.variantExecutionId
            ? { variantExecution: `/v1/executions/${body.experiment.variantExecutionId}` }
            : {}),
          manualEvidenceLink: {
            href: `/v1/investigation-cases/${partialCase.caseId}/evidence`,
            method: "POST",
            body: {
              type: "comparison",
              experimentId: body.experiment.experimentId,
            },
          },
        },
      }),
    });
  });

  await page.goto(`/investigation-cases/${partialCase.caseId}`);
  await page.getByLabel("Comparison preset").selectOption("same");
  await page.getByRole("button", { name: "Start controlled comparison" }).click();
  await expect(
    page.getByText("The comparison exists, but its case evidence link still needs recovery."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start controlled comparison" })).toBeDisabled();
  const partialExperimentId = await page.locator(".case-experiment-result .mono").textContent();
  expect(partialExperimentId).toBeTruthy();
  expect(
    (
      await request.get(`${apiBaseUrl}/v1/comparisons/${partialExperimentId}`, {
        headers: tenantHeaders,
      })
    ).status(),
  ).toBe(200);

  await page.getByRole("button", { name: "Link existing comparison to case" }).click();
  await expect(
    page.getByText("Existing comparison linked to this case. No second comparison was created."),
  ).toBeVisible();
  await expect(page.getByText("Linked to case")).toBeVisible();
  expect(partialCreateRequests).toBe(1);
  await expect(
    page.locator(".case-review-item-heading").getByText(partialExperimentId!, { exact: true }),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

async function createCaseWithExecution(
  request: APIRequestContext,
  executionId: string,
  title: string,
): Promise<{ caseId: string; evidenceId: string }> {
  const created = await request.post(`${apiBaseUrl}/v1/investigation-cases`, {
    headers: tenantHeaders,
    data: {
      title,
      question: "Which bounded policy variation changes the recorded reliability evidence?",
      savedScope: { range: resolvedTestRange() },
    },
  });
  expect(created.status()).toBe(201);
  const caseId = ((await created.json()) as { case: { caseId: string } }).case.caseId;
  const linked = await request.post(`${apiBaseUrl}/v1/investigation-cases/${caseId}/evidence`, {
    headers: tenantHeaders,
    data: { type: "execution", executionId },
  });
  expect(linked.status()).toBe(200);
  const evidenceId = ((await linked.json()) as { evidence: { evidenceId: string } }).evidence
    .evidenceId;
  return { caseId, evidenceId };
}

async function waitForComparison(request: APIRequestContext, experimentId: string) {
  let latest: {
    experiment: {
      status: string;
      originalExecutionId: string;
      variantExecutionId?: string;
    };
  } | null = null;
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBaseUrl}/v1/comparisons/${experimentId}`, {
        headers: tenantHeaders,
      });
      latest = (await response.json()) as typeof latest;
      return latest?.experiment.status;
    })
    .toBe("completed");
  return latest!;
}
