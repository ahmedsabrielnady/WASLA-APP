import test from "node:test";
import assert from "node:assert/strict";
import { fetchTextWithTimeout } from "../src/network.js";

test("fetchTextWithTimeout returns the response and its body", async () => {
  const response = { ok: true, status: 200, text: async () => '[{"id":1}]' };
  const result = await fetchTextWithTimeout(
    "/rest/v1/service_items",
    { method: "GET" },
    100,
    async () => response
  );

  assert.equal(result.response, response);
  assert.equal(result.text, '[{"id":1}]');
});

test("fetchTextWithTimeout aborts a stalled request with a stable timeout code", async () => {
  const stalledFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }, { once: true });
  });

  await assert.rejects(
    fetchTextWithTimeout("/rest/v1/service_items", {}, 5, stalledFetch),
    (error) => error.code === "WASLA_REQUEST_TIMEOUT"
  );
});

test("fetchTextWithTimeout also bounds a stalled response body", async () => {
  const stalledBodyFetch = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    })
  });

  await assert.rejects(
    fetchTextWithTimeout("/rest/v1/service_items", {}, 5, stalledBodyFetch),
    (error) => error.code === "WASLA_REQUEST_TIMEOUT"
  );
});
