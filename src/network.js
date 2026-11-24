/**
 * Read a fetch response under a bounded deadline, including response-body reads.
 * Prevents public UI loading states from hanging forever on stalled API requests.
 */
export async function fetchTextWithTimeout(
  url,
  options = {},
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("WASLA request timed out");
      timeoutError.code = "WASLA_REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
