import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

// Run against a local dashboard whose WHIFFLE_HUB_URL points at an unused port.
const url = process.env.WHIFFLE_SMOKE_URL ?? "http://127.0.0.1:3011/session";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  headless: true,
});
try {
  const width = Number(process.env.SMOKE_WIDTH ?? 1280);
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const machine = {
    machineId: "smoke-machine",
    hostname: "smoke-machine",
    os: "linux",
    status: "online",
    auth: "unknown",
    lastSeenAt: Date.now(),
    harnesses: ["claude", "opencode", "pi"].map((harness) => ({
      harness,
      installed: true,
      capabilities: {
        permissionModes: ["default", "bypassPermissions"],
        effort: false,
      },
    })),
  };
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = [];
    if (path.endsWith("/inspect")) {
      json = { mcp: [], skills: [], plugins: [] };
    } else if (path === "/api/agents") {
      json = [machine];
    } else if (path === "/api/usage/limits") {
      json = { machines: [] };
    }
    return route.fulfill({ json });
  });
  await context.routeWebSocket("**/ws/**", (socket) => {
    socket.send(
      JSON.stringify({
        verb: "frames",
        machineId: "hub",
        payload: { kind: "instances", instances: [], agents: [machine] },
      })
    );
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      assert.ok(
        ["subscribe", "fs", "control"].includes(message.verb),
        `unexpected fleet operation: ${message.verb}`
      );
      if (message.verb !== "subscribe") {
        socket.send(
          JSON.stringify({
            verb: "frames",
            machineId: machine.machineId,
            payload: {
              kind: "control_result",
              requestId: message.payload.requestId,
              ok: true,
              result:
                message.verb === "fs" ||
                message.payload.method === "listSessions"
                  ? []
                  : { mcp: [], skills: [], plugins: [] },
            },
          })
        );
      }
    });
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      "whiffle-spawn-prefs",
      JSON.stringify({
        model: "provider/deepseek",
        permissionMode: "default",
        effort: "high",
      })
    );
    localStorage.setItem(
      "whiffle-models:by-harness",
      JSON.stringify([
        {
          harness: "claude",
          value: "sonnet",
          displayName: "Claude smoke model",
          description: "Claude only",
        },
        {
          harness: "opencode",
          value: "provider/deepseek",
          displayName: "OpenCode smoke model",
          description: "OpenCode only",
        },
      ])
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page
    .getByText("1 machines", { exact: true })
    .first()
    .waitFor({ state: "attached" });
  async function openSpawn() {
    const button = page
      .getByRole("button", { name: "New session", exact: true })
      .filter({ visible: true })
      .first();
    if (!(await button.isVisible())) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    }
    await button.click();
  }
  await openSpawn();
  const form = page.locator("form:has(#spawn-prompt)");
  await form.waitFor();
  const model = form.getByRole("combobox", { name: "Model", exact: true });
  assert.match(await model.innerText(), /Default/);
  await model.click();
  await page
    .getByRole("option", { name: "Claude smoke model Claude only" })
    .waitFor();
  assert.equal(
    await page.getByRole("option", { name: /OpenCode smoke model/ }).count(),
    0
  );
  await page
    .getByRole("option", { name: "Claude smoke model Claude only" })
    .click();
  await form.locator("#spawn-cwd").fill("/scratch/draft");
  await form.locator("#spawn-prompt").fill("Keep this draft after dismissal.");
  await form.locator("#spawn-side-quest").click();
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "hidden" });
  if (width < 900) {
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "New session", exact: true })
      .filter({ visible: true })
      .waitFor({ state: "hidden" });
  }
  await openSpawn();
  await form.waitFor();
  assert.equal(
    await form.locator("#spawn-prompt").inputValue(),
    "Keep this draft after dismissal."
  );
  assert.deepEqual(errors, []);
  assert.equal(await form.locator("#spawn-cwd").inputValue(), "/scratch/draft");
  assert.equal(
    await form.locator("#spawn-side-quest").getAttribute("aria-checked"),
    "true"
  );
  assert.match(await model.innerText(), /Claude smoke model/);
  await form.locator('[aria-labelledby="spawn-harness-label"]').click();
  await page.getByRole("option", { name: "opencode", exact: true }).click();
  assert.match(await model.innerText(), /Default/);
  await model.click();
  await page
    .getByRole("option", { name: "OpenCode smoke model OpenCode only" })
    .waitFor();
  assert.equal(
    await page.getByRole("option", { name: /Claude smoke model/ }).count(),
    0
  );
  await page
    .getByRole("option", { name: "OpenCode smoke model OpenCode only" })
    .click();
  await form.locator('[aria-labelledby="spawn-harness-label"]').click();
  await page.getByRole("option", { name: "claude", exact: true }).click();
  assert.match(await model.innerText(), /Default/);
  assert.equal(
    await form.locator("#spawn-prompt").inputValue(),
    "Keep this draft after dismissal."
  );
  console.log(
    "PASS: legacy preference isolation, harness-scoped models, harness switch resets model, dismissed draft retained"
  );
  const observer = await readFile(
    join(homedir(), ".claude/skills/ui-observer/observer.browser.js"),
    "utf8"
  );
  await page.evaluate(observer);
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const scopeSel = "form:has(#spawn-prompt) .grid-cols-2";
        const scope = document.querySelector(scopeSel);
        const report = globalThis.__uiObserver({ scopeSel });
        return {
          viewport: report.viewport,
          scope: {
            matchCount: document.querySelectorAll(scopeSel).length,
            usedElement: scope?.tagName,
          },
          contentStats: {
            elements: scope?.querySelectorAll("*").length,
            textChars: scope?.textContent?.length,
          },
          containers: report.containers.slice(0, 1),
          observations: report.observations,
          pageWidth: document.documentElement.scrollWidth,
        };
      })
    )
  );
} finally {
  await browser.close();
}
