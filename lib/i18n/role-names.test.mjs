import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_ROLE_IDS } from "@oh-my-pi/pi-coding-agent/config/model-roles";

import { BUILTIN_ROLE_IDS, roleNameKey, translateRoleName } from "./role-names.ts";
import { enLocale } from "./messages/en.ts";
import { zhCNLocale } from "./messages/zh-CN.ts";

test("tracks every model role the agent ships", () => {
  assert.deepEqual([...BUILTIN_ROLE_IDS].sort(), [...MODEL_ROLE_IDS].sort());
});

test("every built-in role has a localized name in both catalogs", () => {
  const missing = [];
  for (const roleId of MODEL_ROLE_IDS) {
    const key = roleNameKey(roleId);
    assert.ok(key, `no key for ${roleId}`);
    if (!(key in enLocale.messages)) missing.push(`en:${key}`);
    if (!(key in zhCNLocale.messages)) missing.push(`zh:${key}`);
  }
  assert.deepEqual(missing, []);
});

test("falls back to the agent label for roles defined in config", () => {
  const t = (key) => key;
  assert.equal(translateRoleName("custom-role", "My role", t), "My role");
  // A catalog that lost the key returns the key itself; the agent label wins.
  assert.equal(translateRoleName("smol", "Fast", t), "Fast");
});

test("returns the catalog label for built-in roles", () => {
  const t = (key) => (key === "roles.name.smol" ? "快速" : key);
  assert.equal(translateRoleName("smol", "Fast", t), "快速");
});
