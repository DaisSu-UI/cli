import test from "node:test";
import assert from "node:assert/strict";
import { updateStatus } from "../dist/updates.js";
test("update is offline by default and never installs anything", async () => {
  let called = false;
  const result = await updateStatus({
    fetcher: async () => {
      called = true;
      throw Error();
    },
  });
  assert.equal(result.status, "offline");
  assert(!called);
});
test("explicit update handles available versions, missing packages and registry failures", async () => {
  let result = await updateStatus({
    check: true,
    fetcher: async () =>
      new Response(JSON.stringify({ "dist-tags": { beta: "99.0.0" } })),
  });
  assert(result.updateAvailable);
  assert(result.suggestedCommand.includes("99.0.0"));
  result = await updateStatus({
    check: true,
    fetcher: async () => new Response("", { status: 404 }),
  });
  assert.equal(result.status, "not-published");
  result = await updateStatus({
    check: true,
    fetcher: async () => {
      throw Error("token=secret");
    },
  });
  assert.equal(result.status, "unavailable");
  assert(!JSON.stringify(result).includes("secret"));
});
test("invalid registry and timeout are rejected before a request", async () => {
  await assert.rejects(
    () =>
      updateStatus({
        check: true,
        registry: "https://user:secret@example.test/",
      }),
    /不含凭据/,
  );
  await assert.rejects(
    () => updateStatus({ check: true, timeout: -1 }),
    /超时/,
  );
});
