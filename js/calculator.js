// Xavfsiz arifmetik hisoblash: faqat sonlar, + - * / va qavslar. eval ishlatilmaydi.

export class CalcError extends Error {}

export function safeEval(expr) {
  const s = String(expr)
    .replace(/[×xX]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if (!s) throw new CalcError("EMPTY");

  let i = 0;
  const peek = () => s[i];

  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function parseTerm() {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const r = parseFactor();
      if (op === "/") {
        if (r === 0) throw new CalcError("DIV0");
        v /= r;
      } else {
        v *= r;
      }
    }
    return v;
  }

  function parseFactor() {
    const c = peek();
    if (c === "+") { i++; return parseFactor(); }
    if (c === "-") { i++; return -parseFactor(); }
    if (c === "(") {
      i++;
      const v = parseExpr();
      if (s[i++] !== ")") throw new CalcError("SYNTAX");
      return v;
    }
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (!m) throw new CalcError("SYNTAX");
    i += m[0].length;
    return parseFloat(m[0]);
  }

  const v = parseExpr();
  if (i !== s.length || !Number.isFinite(v)) throw new CalcError("SYNTAX");
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(10)));
}
