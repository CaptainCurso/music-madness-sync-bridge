import assert from "node:assert/strict";
import { isLocalProxyBaseUrl } from "../src/foundry/proxy-lifecycle.js";

assert.equal(isLocalProxyBaseUrl("http://127.0.0.1:8788"), true);
assert.equal(isLocalProxyBaseUrl("http://localhost:8788"), true);
assert.equal(isLocalProxyBaseUrl("http://192.168.1.105:30000"), false);

console.log("proxy lifecycle tests passed");
