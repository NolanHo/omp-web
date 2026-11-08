import assert from "node:assert/strict";
import test from "node:test";

import { getWebThemePalette } from "./omp-theme.ts";

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `expected a six-digit hex colour, got ${hex}`);
  const digits = match[1];
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    channel(Number.parseInt(digits.slice(offset, offset + 2), 16)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ["porcelain", "light", "titanium"]) {
  test(`${theme} keeps user bubble text and links readable`, async () => {
    const { variables } = await getWebThemePalette(theme);
    const background = variables["--user-bg"];
    assert.ok(
      contrast(variables["--user-text"], background) >= 4.5,
      `${theme}: text contrast on the user bubble`,
    );
    assert.ok(
      contrast(variables["--user-link"], background) >= 4.5,
      `${theme}: link contrast on the user bubble`,
    );
  });
}
