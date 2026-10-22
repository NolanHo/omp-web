import assert from "node:assert/strict";
import test from "node:test";

import { enLocale } from "./messages/en.ts";
import { zhCNLocale } from "./messages/zh-CN.ts";

const PLACEHOLDER = /\{([\w.-]+)\}/g;

function placeholders(message) {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

/**
 * Keys whose English form carries grammar the Chinese form cannot express.
 *
 * `{countSuffix}` is the English plural suffix ("s" or ""); Chinese has no
 * plural marker, so the Chinese message drops it on purpose.
 */
const ENGLISH_ONLY_PLACEHOLDERS = new Set(["files.conflictSummary"]);

test("both catalogs expose the same keys", () => {
  const en = Object.keys(enLocale.messages).sort();
  const zh = Object.keys(zhCNLocale.messages).sort();
  assert.deepEqual(zh, en);
});

test("every message uses the same placeholders in both languages", () => {
  const mismatched = [];
  for (const [key, en] of Object.entries(enLocale.messages)) {
    const zh = zhCNLocale.messages[key];
    if (typeof zh !== "string" || ENGLISH_ONLY_PLACEHOLDERS.has(key)) continue;
    const enNames = placeholders(en);
    const zhNames = placeholders(zh);
    if (JSON.stringify(enNames) !== JSON.stringify(zhNames)) {
      mismatched.push({ key, en: enNames, zh: zhNames });
    }
  }
  assert.deepEqual(mismatched, []);
});

test("Chinese messages use a single ellipsis and no ASCII ellipsis", () => {
  const offenders = Object.entries(zhCNLocale.messages)
    .filter(([, message]) => message.includes("..."))
    .map(([key]) => key);
  assert.deepEqual(offenders, []);
});

test("Chinese messages keep full-width punctuation around sentences", () => {
  const offenders = [];
  for (const [key, message] of Object.entries(zhCNLocale.messages)) {
    // A CJK character directly followed by an ASCII comma/colon ending the
    // clause is the signature of an untranslated English sentence structure.
    if (/[\u4e00-\u9fff],/.test(message) || /[\u4e00-\u9fff];/.test(message)) {
      offenders.push({ key, message });
    }
  }
  assert.deepEqual(offenders, []);
});
