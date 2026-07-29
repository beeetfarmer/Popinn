import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("honours conditional object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("flattens arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("lets the last conflicting tailwind utility win", () => {
    // This is the whole reason cn wraps twMerge rather than just clsx.
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("keeps non-conflicting tailwind utilities side by side", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("resolves conflicts across conditional branches", () => {
    expect(cn("p-2", { "p-8": true })).toBe("p-8");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
