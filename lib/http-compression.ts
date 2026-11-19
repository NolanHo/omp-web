import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

/**
 * Response compression for the read endpoints that carry a whole transcript.
 *
 * `next start` compresses only the pages it renders itself; a route handler's
 * `NextResponse.json` leaves the server as raw JSON. A session transcript is
 * several megabytes of well-compressible text (hundreds of messages, each with
 * tool output), so the browser spends most of its history-loading time waiting
 * for bytes it will throw away after parsing. These helpers encode such a body
 * once, on the server, and advertise it through `Content-Encoding`.
 *
 * Brotli is preferred because transcripts are text-heavy and brotli lands
 * 25-35% smaller than gzip at the same speed class; gzip stays as the fallback
 * for clients that do not accept brotli.
 */

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Bodies below this size are cheaper to send as-is than to encode and flag. */
export const MIN_COMPRESSED_BODY_BYTES = 1024;

/**
 * A payload is only encoded when the result is meaningfully smaller: compressing
 * an already-compressed body (base64 images, incompressible tool output) costs
 * CPU and adds bytes.
 *
 * In practice a transcript is 5-7x smaller once encoded, so this is a defensive
 * net for a pathological payload rather than a branch real traffic takes; it is
 * skipped only for a client that refused identity, which leaves no alternative.
 */
const MIN_COMPRESSION_GAIN = 0.9;

/** Brotli quality 5 keeps a multi-megabyte transcript under ~100 ms of CPU. */
const BROTLI_PARAMS = { [constants.BROTLI_PARAM_QUALITY]: 5 } as const;

export type ContentEncoding = "br" | "gzip";

/**
 * What `Accept-Encoding` allows for one response.
 *
 * `unacceptable` is its own outcome, not a synonym for identity: a client that
 * sent `identity;q=0` has refused the unencoded representation, so answering
 * with raw JSON would ignore its own statement. See `jsonResponse`.
 */
export type EncodingChoice =
  | { kind: "encoded"; encoding: ContentEncoding; identityAcceptable: boolean }
  | { kind: "identity" }
  | { kind: "unacceptable" };

/** RFC 9110 qvalue grammar: 0 to 3 decimals, never outside 0..1. */
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Parse an `Accept-Encoding` header into `name -> q`, dropping entries whose
 * `q` does not match the grammar.
 *
 * `q=0` means "not acceptable", which is why the weight is kept instead of the
 * token alone: `br;q=0, gzip` must pick gzip rather than brotli. A malformed
 * weight is dropped rather than guessed: `gzip;q=0.5junk` must not be read as
 * `0.5`, and an entry that cannot be parsed must not grant an encoding. Duplicate
 * names keep their first occurrence, since the grammar forbids repeats and the
 * first is the one an intermediary is most likely to have meant.
 */
function parseAcceptEncoding(header: string): Map<string, number> {
  const entries = new Map<string, number>();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;

    let quality = 1;
    let malformed = false;
    let sawQuality = false;
    for (const param of params) {
      const separator = param.indexOf("=");
      const key = (separator === -1 ? param : param.slice(0, separator)).trim().toLowerCase();
      if (key !== "q") continue;
      // `q` is defined to carry a weight: a bare `q`, a repeated `q`, or a weight
      // outside the grammar leaves the entry's intent unknown, so it grants
      // nothing rather than silently claiming full preference.
      if (separator === -1 || sawQuality) {
        malformed = true;
        break;
      }
      sawQuality = true;
      const value = param.slice(separator + 1).trim();
      if (!QVALUE.test(value)) {
        malformed = true;
        break;
      }
      quality = Number.parseFloat(value);
    }
    if (malformed || entries.has(name)) continue;
    entries.set(name, quality);
  }
  return entries;
}

/**
 * Decide the response encoding for one request.
 *
 * RFC 9110 §12.5.3 semantics: a name matches its own entry, or `*` when the name
 * is not listed. `br` and `gzip` are not acceptable unless the header says so,
 * while `identity` is acceptable unless the header refuses it — directly through
 * `identity;q=0`, or implicitly through `*;q=0` with no explicit `identity`
 * entry. An absent header means "no preference stated", and we answer it with
 * identity so a client that never asked for an encoding is not handed one.
 *
 * Brotli wins ties against gzip, and both beat identity.
 */
export function selectContentEncoding(acceptEncoding: string | null | undefined): EncodingChoice {
  if (!acceptEncoding) return { kind: "identity" };

  const entries = parseAcceptEncoding(acceptEncoding);
  const wildcard = entries.get("*");
  const qualityOf = (name: string): number => entries.get(name) ?? wildcard ?? 0;
  const identityAcceptable = (entries.has("identity") ? entries.get("identity")! : (wildcard ?? 1)) > 0;

  const brotli = qualityOf("br");
  const gzipQuality = qualityOf("gzip");
  if (brotli > 0 || gzipQuality > 0) {
    const encoding: ContentEncoding = brotli <= 0
      ? "gzip"
      : gzipQuality <= 0
        ? "br"
        : brotli >= gzipQuality ? "br" : "gzip";
    return { kind: "encoded", encoding, identityAcceptable };
  }

  return identityAcceptable ? { kind: "identity" } : { kind: "unacceptable" };
}

/** Encode a body with the chosen algorithm. */
export async function compressBody(body: Uint8Array, encoding: ContentEncoding): Promise<Buffer> {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (encoding === "br") {
    return brotliCompressAsync(buffer, {
      params: { ...BROTLI_PARAMS, [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length },
    });
  }
  return gzipAsync(buffer, { level: 6 });
}

/**
 * A `Response` body that TypeScript accepts.
 *
 * Node's `Buffer` views a shared-typed `ArrayBufferLike`, which the DOM
 * `BodyInit` union rejects; an owned `ArrayBuffer` is what the runtime expects
 * anyway, and the copy is a few milliseconds even for a large transcript.
 */
function toBodyInit(body: Uint8Array): Uint8Array<ArrayBuffer> {
  // Node's `Buffer` always views a plain `ArrayBuffer` (never a shared one), and
  // both sources here — `Buffer.from(string)` and zlib's output — own their
  // bytes, so no copy is needed; only the DOM type parameter has to be narrowed.
  return body as Uint8Array<ArrayBuffer>;
}

/**
 * Build a JSON response, compressed when the client accepts it and the body is
 * large enough to gain from it.
 *
 * `Vary: Accept-Encoding` is always set so an intermediary never hands a
 * compressed body to a client that did not ask for one.
 *
 * A client that refuses identity and offers no encoding we can produce gets an
 * empty `406`, not raw JSON: the body is the one thing it said it cannot accept.
 * For the same reason a client that refused identity gets an encoded body even
 * when the payload is small enough, or gains too little, to be worth encoding —
 * the size floor is a preference, and the client's refusal is a constraint.
 */
export async function jsonResponse(
  request: Request,
  data: unknown,
  init: { status?: number; headers?: HeadersInit; compress?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.append("Vary", "Accept-Encoding");

  const choice: EncodingChoice = init.compress === false
    ? { kind: "identity" }
    : selectContentEncoding(request.headers.get("accept-encoding"));
  if (choice.kind === "unacceptable") {
    return new Response(null, { status: 406, headers });
  }

  headers.set("Content-Type", "application/json; charset=utf-8");
  const raw = Buffer.from(JSON.stringify(data), "utf8");
  const mustEncode = choice.kind === "encoded" && !choice.identityAcceptable;

  if (choice.kind === "identity" || (!mustEncode && raw.length < MIN_COMPRESSED_BODY_BYTES)) {
    headers.set("Content-Length", String(raw.length));
    return new Response(toBodyInit(raw), { status: init.status ?? 200, headers });
  }

  const { encoding } = choice;
  const compressed = await compressBody(raw, encoding);
  if (!mustEncode && compressed.length >= raw.length * MIN_COMPRESSION_GAIN) {
    headers.set("Content-Length", String(raw.length));
    return new Response(toBodyInit(raw), { status: init.status ?? 200, headers });
  }

  headers.set("Content-Encoding", encoding);
  headers.set("Content-Length", String(compressed.length));
  return new Response(toBodyInit(compressed), { status: init.status ?? 200, headers });
}
