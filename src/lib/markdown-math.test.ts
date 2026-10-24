import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { mathOptions, normalizeMath } from "./markdown-math";

function mathValues(text: string): string[] {
  const parser = unified().use(remarkParse).use(remarkMath, mathOptions);
  const values: string[] = [];
  interface Node {
    type: string;
    value?: string;
    children?: Node[];
  }
  function walk(node: Node) {
    if (node.type === "math" || node.type === "inlineMath") values.push(node.value ?? "");
    node.children?.forEach(walk);
  }
  walk(parser.parse(normalizeMath(text)));
  return values;
}

describe("math and currency delimiters", () => {
  it("does not parse USD amounts as math", () => {
    expect(mathValues("It costs $25 USD, or $50 for two; $1,000.50 total.")).toEqual([]);
  });
  it("parses single-dollar equations", () => {
    expect(mathValues("$x + y$ and $E=mc^2$ and $\\frac{1}{2}$")).toEqual([
      "x + y",
      "E=mc^2",
      "\\frac{1}{2}",
    ]);
  });
  it("keeps money literal beside dollar equations", () => {
    expect(mathValues("$25 USD and $x$ and $50 USD; $2 + 2 = 4$.")).toEqual(["x", "2 + 2 = 4"]);
  });
  it("does not pair currency amounts or prose as equations", () => {
    expect(mathValues("$25$ or $50 USD$; $hello world$; $25 per item and $50 total")).toEqual([]);
  });
  it("respects escaped dollars", () => {
    expect(mathValues("\\$x\\$ and \\$25; $y^2$")).toEqual(["y^2"]);
  });
  it("does not match single-dollar math across lines", () => {
    expect(mathValues("$x\n+ y$")).toEqual([]);
  });
  it("allows explicit numeric math when an amount is ambiguous", () => {
    expect(mathValues("\\(25\\) and $$50$$")).toEqual(["25", "50"]);
  });
  it("parses explicit inline math beside currency", () => {
    expect(mathValues("$25 USD and \\(x + y\\) and $50 USD")).toEqual(["x + y"]);
  });
  it("preserves double-dollar and bracketed display math", () => {
    expect(mathValues("$$x^2$$\n\n\\[y^2\\]")).toEqual(["x^2", "y^2"]);
  });
  it("leaves code examples untouched", () => {
    const code = "`\\(x\\)`\n\n```tex\n\\[y\\]\n$x + y$\n```\n\n~~~tex\n$x$\n~~~";
    expect(normalizeMath(code)).toBe(code);
    expect(mathValues(code)).toEqual([]);
  });
});
