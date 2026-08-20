import { describe, expect, it } from "vitest";

import { isValidLocalName, sanitizeLocalName, uniqueLocalName } from "@/lib/terraform/identifiers";

describe("isValidLocalName", () => {
  it.each(["main", "_private", "web-1", "a", "web_server_2"])("accepts %s", (name) => {
    expect(isValidLocalName(name)).toBe(true);
  });

  it.each(["", "1web", "-lead", "has space", "has.dot", "emoji✨"])("rejects %s", (name) => {
    expect(isValidLocalName(name)).toBe(false);
  });
});

describe("sanitizeLocalName", () => {
  it("lowercases and replaces illegal characters", () => {
    expect(sanitizeLocalName("Web Server!")).toBe("web_server");
  });

  it("prefixes an underscore when the result would start with a digit", () => {
    expect(sanitizeLocalName("1st-network")).toBe("_1st-network");
  });

  it("trims leading and trailing separators", () => {
    expect(sanitizeLocalName("  --web--  ")).toBe("web");
  });

  it("falls back to a usable name when nothing survives cleaning", () => {
    expect(sanitizeLocalName("!!!")).toBe("resource");
    expect(sanitizeLocalName("")).toBe("resource");
  });

  it("always produces a valid local name", () => {
    for (const input of ["Web Server!", "1st", "!!!", "", "  --x--  ", "ÜBER"]) {
      expect(isValidLocalName(sanitizeLocalName(input)), input).toBe(true);
    }
  });
});

describe("uniqueLocalName", () => {
  it("returns the sanitized name when it is free", () => {
    expect(uniqueLocalName("web", [])).toBe("web");
  });

  it("appends a counter when the name is taken", () => {
    expect(uniqueLocalName("web", ["web"])).toBe("web_2");
    expect(uniqueLocalName("web", ["web", "web_2"])).toBe("web_3");
  });

  it("skips over gaps rather than reusing a taken suffix", () => {
    expect(uniqueLocalName("web", ["web", "web_3"])).toBe("web_2");
  });

  it("sanitizes before checking for collisions", () => {
    expect(uniqueLocalName("Web Server", ["web_server"])).toBe("web_server_2");
  });
});
