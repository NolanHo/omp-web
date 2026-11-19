import assert from "node:assert/strict";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import test from "node:test";

const {
  MIN_COMPRESSED_BODY_BYTES,
  compressBody,
  jsonResponse,
  selectContentEncoding,
} = await import("./http-compression.ts");

/** A transcript-sized payload: repetitive JSON, like real message arrays. */
function largePayload(count = 400) {
  return {
    context: {
      messages: Array.from({ length: count }, (_, index) => ({
        id: `entry-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message body ${index} `.repeat(12),
      })),
    },
  };
}

/** Flatten a negotiation result to the word the assertions read best with. */
function chosen(acceptEncoding) {
  const choice = selectContentEncoding(acceptEncoding);
  if (choice.kind === "encoded") return choice.encoding;
  return choice.kind;
}

function request(acceptEncoding, url = "http://127.0.0.1:30141/api/sessions") {
  const headers = new Headers();
  if (acceptEncoding !== undefined) headers.set("accept-encoding", acceptEncoding);
  return new Request(url, { headers });
}

test("selectContentEncoding prefers brotli when the client accepts both", () => {
  assert.equal(chosen("gzip, deflate, br, zstd"), "br");
  assert.equal(chosen("BR"), "br");
  assert.equal(chosen("br, gzip"), "br");
});

test("selectContentEncoding falls back to gzip when brotli is absent or refused", () => {
  assert.equal(chosen("gzip, deflate"), "gzip");
  assert.equal(chosen("br;q=0, gzip"), "gzip");
  assert.equal(chosen("gzip;q=0.4, br;q=0.6"), "br");
  assert.equal(chosen("br;q=0.5, gzip;q=0.5"), "br");
});

test("selectContentEncoding answers identity when the client asks for no encoding", () => {
  assert.equal(chosen(null), "identity");
  assert.equal(chosen(""), "identity");
  assert.equal(chosen("identity"), "identity");
  assert.equal(chosen("deflate"), "identity");
  assert.equal(chosen("br;q=0, gzip;q=0"), "identity");
});

test("selectContentEncoding reports unacceptable when identity is refused too", () => {
  assert.equal(chosen("identity;q=0"), "unacceptable");
  assert.equal(chosen("identity;q=0, gzip;q=0, br;q=0"), "unacceptable");
  assert.equal(chosen("*;q=0"), "unacceptable");
});

test("selectContentEncoding keeps an explicitly offered encoding over a refused identity", () => {
  assert.equal(chosen("identity;q=0, gzip"), "gzip");
  assert.equal(chosen("identity;q=0, *"), "br");
  assert.equal(chosen("identity;q=0, gzip;q=0.1, br;q=0.2"), "br");
});

test("selectContentEncoding honours a wildcard and explicit entries over it", () => {
  assert.equal(chosen("*"), "br");
  assert.equal(chosen("gzip, *;q=0.1"), "gzip");
  assert.equal(chosen("gzip, br;q=0"), "gzip");
  assert.equal(chosen("*;q=0, identity"), "identity");
});

test("selectContentEncoding drops entries whose qvalue is malformed", () => {
  // `0.2junk` must not be read as 0.2, and an unparseable weight must not grant
  // an encoding the client did not validly ask for.
  assert.equal(chosen("gzip;q=0.2junk"), "identity");
  assert.equal(chosen("br;q=1.5"), "identity");
  assert.equal(chosen("br;q=-1"), "identity");
  assert.equal(chosen("br;q=0.2junk, gzip"), "gzip");
  // A duplicate token keeps its first occurrence.
  assert.equal(chosen("gzip;q=0, gzip"), "identity");
});

test("compressBody round-trips through both encodings", async () => {
  const raw = Buffer.from(JSON.stringify(largePayload()), "utf8");
  const gzipped = await compressBody(raw, "gzip");
  const brotlied = await compressBody(raw, "br");
  assert.equal(gunzipSync(gzipped).toString("utf8"), raw.toString("utf8"));
  assert.equal(brotliDecompressSync(brotlied).toString("utf8"), raw.toString("utf8"));
  assert.ok(gzipped.length < raw.length);
  assert.ok(brotlied.length < gzipped.length);
});

test("jsonResponse compresses a transcript-sized body and keeps it valid JSON", async () => {
  const payload = largePayload();
  const response = await jsonResponse(request("br, gzip"), payload);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "br");
  assert.match(response.headers.get("vary") ?? "", /Accept-Encoding/i);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");

  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get("content-length"), String(body.length));
  assert.deepEqual(JSON.parse(brotliDecompressSync(body).toString("utf8")), payload);
});

test("jsonResponse uses gzip when that is all the client accepts", async () => {
  const response = await jsonResponse(request("gzip"), largePayload());
  assert.equal(response.headers.get("content-encoding"), "gzip");
  const body = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(JSON.parse(gunzipSync(body).toString("utf8")), largePayload());
});

test("jsonResponse leaves small and unasked-for bodies uncompressed", async () => {
  const small = await jsonResponse(request("br"), { ok: true });
  assert.equal(small.headers.get("content-encoding"), null);
  assert.equal(small.headers.get("content-length"), String(Buffer.byteLength('{"ok":true}')));
  assert.deepEqual(await small.json(), { ok: true });

  const unasked = await jsonResponse(request(undefined), largePayload());
  assert.equal(unasked.headers.get("content-encoding"), null);
  const body = Buffer.from(await unasked.arrayBuffer());
  assert.ok(body.length > MIN_COMPRESSED_BODY_BYTES);
});

test("jsonResponse refuses to answer a client that rejects identity", async () => {
  const response = await jsonResponse(request("identity;q=0"), largePayload());
  assert.equal(response.status, 406);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.match(response.headers.get("vary") ?? "", /Accept-Encoding/i);
  assert.equal(await response.text(), "");
});

test("jsonResponse keeps caller headers and can opt out", async () => {
  const response = await jsonResponse(request("br"), largePayload(), {
    status: 201,
    headers: { "Cache-Control": "no-store" },
    compress: false,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-encoding"), null);
});
