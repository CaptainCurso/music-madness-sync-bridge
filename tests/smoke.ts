import assert from "node:assert/strict";
import { extractMediaUrls, extensionFromMimeOrName } from "../src/utils/media.js";
import { sha256 } from "../src/utils/hash.js";

const html = `<p>Hello</p><img src="https://example.com/a.png"><a href="/assets/doc.pdf">Doc</a>`;
const urls = extractMediaUrls(html);

assert.equal(urls.length, 2);
assert.equal(urls[0], "https://example.com/a.png");
assert.equal(urls[1], "/assets/doc.pdf");
assert.equal(extensionFromMimeOrName("image/jpeg"), "jpg");
assert.equal(extensionFromMimeOrName(undefined, "photo.webp"), "webp");
assert.equal(sha256("abc").length, 64);

console.log("smoke tests passed");
