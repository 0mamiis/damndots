import assert from "node:assert/strict";
import test from "node:test";
import { sameOrigin, validateServer, requestProtocol } from "../lib/session";

test("the BFF accepts its browser Host even when Next normalizes Request.url to localhost", () => {
  const request = new Request("http://localhost:4320/api/session", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4320",
      origin: "http://127.0.0.1:4320",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(sameOrigin(request), true);
});

test("the BFF rejects cross-origin mutation and keeps HTTPS behind a proxy", () => {
  const attack = new Request("http://localhost:4320/api/session", {
    method: "POST",
    headers: {
      host: "dots.example.com",
      origin: "https://attacker.example.com",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(sameOrigin(attack), false);
  const tls = new Request("http://localhost:4320/api/session", {
    method: "POST",
    headers: {
      host: "dots.example.com",
      origin: "https://dots.example.com",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(sameOrigin(tls), true);
  assert.equal(requestProtocol(tls), "https");
});

test("only loopback servers can use unencrypted HTTP", () => {
  assert.equal(
    validateServer("http://127.0.0.1:4318/"),
    "http://127.0.0.1:4318",
  );
  assert.equal(
    validateServer("http://localhost:4318"),
    "http://localhost:4318",
  );
  assert.equal(validateServer("http://[::1]:4318"), "http://[::1]:4318");
  assert.equal(
    validateServer("https://dots.example.com/"),
    "https://dots.example.com",
  );
  for (const value of [
    "http://dots.example.com",
    "http://192.168.1.2:4318",
    "https://admin:password@dots.example.com",
    "file:///C:/secrets",
    "https://dots.example.com/?token=secret",
    "https://dots.example.com/#token",
  ]) {
    assert.throws(() => validateServer(value));
  }
});
