import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveLtePassword,
  getAllPasswords,
  LTE_PASSWORDS,
  PASSWORD_TO_SLOT
} from "../lte-passwords.js";

describe("lte-passwords", () => {
  const passwordCount = getAllPasswords().length;

  it(`has ${passwordCount} passwords (more than 80 for safety)`, () => {
    assert.ok(passwordCount >= 80);
  });

  it("maps all passwords to slots", () => {
    for (const { slot, password } of getAllPasswords()) {
      assert.strictEqual(PASSWORD_TO_SLOT[password], slot);
    }
  });

  it("resolveLtePassword returns slot for valid password", () => {
    assert.strictEqual(resolveLtePassword("gray-shark"), 1);
    assert.strictEqual(resolveLtePassword("blue-whale"), 2);
    const lastPassword = getAllPasswords().pop().password;
    const lastSlot = getAllPasswords().pop().slot;
    assert.strictEqual(resolveLtePassword(lastPassword), lastSlot);
  });

  it("resolveLtePassword is case insensitive", () => {
    assert.strictEqual(resolveLtePassword("GRAY-SHARK"), 1);
    assert.strictEqual(resolveLtePassword("Gray-Shark"), 1);
    assert.strictEqual(resolveLtePassword("gray-shark"), 1);
  });

  it("resolveLtePassword handles whitespace", () => {
    assert.strictEqual(resolveLtePassword("  gray-shark  "), 1);
  });

  it("resolveLtePassword returns null for invalid password", () => {
    assert.strictEqual(resolveLtePassword(""), null);
    assert.strictEqual(resolveLtePassword("invalid"), null);
    assert.strictEqual(resolveLtePassword("gray-fish"), null);
  });

  it("getAllPasswords returns sorted array", () => {
    const passwords = getAllPasswords();
    assert.strictEqual(passwords[0].slot, 1);
    assert.strictEqual(passwords[0].password, "gray-shark");
    assert.strictEqual(passwords[79].slot, 80);
  });
});

describe("parseRangeHeader", () => {
  const parseRangeHeader = (rangeHeader, size) => {
    if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
      return null;
    }

    const [rawStart, rawEnd] = rangeHeader.slice(6).split("-", 2);
    let start;
    let end;

    if (rawStart === "") {
      const suffixLength = Number.parseInt(rawEnd, 10);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0 || suffixLength > size) {
        return "invalid";
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number.parseInt(rawStart, 10);
      end = rawEnd === "" ? size - 1 : Number.parseInt(rawEnd, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return "invalid";
      }
    }

    if (start < 0 || end < start || start >= size) {
      return "invalid";
    }

    end = Math.min(end, size - 1);
    return { start, end };
  };

  it("returns null for missing range header", () => {
    assert.strictEqual(parseRangeHeader(undefined, 1000), null);
    assert.strictEqual(parseRangeHeader(null, 1000), null);
    assert.strictEqual(parseRangeHeader("", 1000), null);
    assert.strictEqual(parseRangeHeader("invalid", 1000), null);
  });

  it("parses simple range", () => {
    const result = parseRangeHeader("bytes=0-99", 1000);
    assert.deepStrictEqual(result, { start: 0, end: 99 });
  });

  it("parses open-ended range", () => {
    const result = parseRangeHeader("bytes=500-", 1000);
    assert.deepStrictEqual(result, { start: 500, end: 999 });
  });

  it("parses suffix range", () => {
    const result = parseRangeHeader("bytes=-100", 1000);
    assert.deepStrictEqual(result, { start: 900, end: 999 });
  });

  it("returns invalid for suffix length of 0", () => {
    assert.strictEqual(parseRangeHeader("bytes=-0", 1000), "invalid");
  });

  it("returns invalid for range exceeding size", () => {
    // Suffix larger than size is invalid
    assert.strictEqual(parseRangeHeader("bytes=-2000", 1000), "invalid");
    // But start beyond size is invalid
    assert.strictEqual(parseRangeHeader("bytes=2000-", 1000), "invalid");
  });

  it("returns invalid for reversed range (start > end)", () => {
    assert.strictEqual(parseRangeHeader("bytes=100-50", 1000), "invalid");
  });

  it("clamps end to size-1", () => {
    const result = parseRangeHeader("bytes=500-2000", 1000);
    assert.deepStrictEqual(result, { start: 500, end: 999 });
  });
});