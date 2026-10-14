import assert from "node:assert/strict";
import { it } from "node:test";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function responseFromChunks(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }));
}

it("logs a headerless upstream SSE error without consuming or exposing extra fields", async () => {
  const frame = `event: error\r\ndata: ${JSON.stringify({
    code: "invalid_request_error",
    type: "invalid_request_error",
    message: "Missing tool definition",
    authorization: "secret",
    input: ["private input"],
  })}\r\n\r\n`;
  const messages = [];
  const peek = await new CodexExecutor()._peekSseTransientError(
    responseFromChunks([frame.slice(0, 30), frame.slice(30)]),
    { warn: (tag, message) => messages.push([tag, JSON.parse(message)]) },
  );

  assert.deepEqual(messages, [["CODEX_UPSTREAM_ERROR", {
    event: "error",
    code: "invalid_request_error",
    type: "invalid_request_error",
    message: "Missing tool definition",
  }]]);
  assert.equal(await new Response(peek.replacementBody).text(), frame);
});

it("extracts a nested response.failed error", async () => {
  const messages = [];
  const peek = await new CodexExecutor()._peekSseTransientError(
    responseFromChunks([`data: ${JSON.stringify({
      type: "response.failed",
      response: { error: { code: "invalid_request_error", message: "Bad input" } },
    })}\n\n`]),
    { warn: (_tag, message) => messages.push(JSON.parse(message)) },
  );

  assert.deepEqual(messages, [{
    event: "response.failed",
    code: "invalid_request_error",
    message: "Bad input",
  }]);
  await new Response(peek.replacementBody).text();
});

it("does not log ordinary output even when its text contains an error object", async () => {
  const messages = [];
  const frame = `event: response.output_text.delta\ndata: ${JSON.stringify({
    type: "response.output_text.delta",
    delta: '{"error":{"message":"private text"}}',
  })}\n\n`;
  const peek = await new CodexExecutor()._peekSseTransientError(
    responseFromChunks([frame]),
    { warn: (...args) => messages.push(args) },
  );

  assert.deepEqual(messages, []);
  assert.equal(await new Response(peek.replacementBody).text(), frame);
});
