import assert from "node:assert/strict";
import test from "node:test";
import { allowedServers, validateServer } from "../lib/session";

test("an unset allow-list keeps the local-first behavior", () => {
  assert.equal(allowedServers({}), null);
  assert.equal(validateServer("http://127.0.0.1:9340", null), "http://127.0.0.1:9340");
});
test("a configured server is the only address the dashboard will call", () => {
  const allowed = allowedServers({ DOTS_SERVER_URL: "https://dots.example.com/" });
  assert.deepEqual([...(allowed ?? [])], ["https://dots.example.com"]);
  assert.equal(validateServer("https://dots.example.com", allowed), "https://dots.example.com");
  for (const other of ["http://127.0.0.1:9340", "https://169.254.169.254", "https://internal.example.com"])
    assert.throws(() => validateServer(other, allowed), /yapılandırılmış/);
});
test("several servers can be allowed", () => {
  const allowed = allowedServers({ DOTS_ALLOWED_SERVERS: "http://127.0.0.1:9340, https://a.example.com" });
  assert.equal(allowed?.size, 2);
  assert.equal(validateServer("https://a.example.com", allowed), "https://a.example.com");
});
