/**
 * Constrained CEL profile evaluator.
 *
 * Implements the subset of CEL the pack spec allows (§5): literals, identifiers,
 * member access (with PCG/node sugar), function & method calls, the collection
 * macros exists/all/exists_one/filter, has(), and the operators
 * == != < <= > >= && || ! in ?:  — nothing else.
 *
 * Why hand-rolled and not a cel-js dependency: the review flagged TS CEL maturity
 * as the #1 unknown. A bounded profile evaluator removes the dependency risk and
 * makes the allowed surface auditable. The production path can swap in full CEL
 * behind the same `evaluate()` signature.
 */

import type { ProjectContextGraph, PcgNodeData } from "./types";

/** Thrown when a condition references a missing attribute/prop (can't be determined). */
export class IndeterminateError extends Error {}
/** Thrown for malformed expressions or out-of-profile constructs (fails validation). */
export class CelError extends Error {}

const MACROS = new Set(["exists", "all", "exists_one", "filter"]);
const PCG_METHODS = new Set(["has", "count", "nodes", "edge", "attr"]);
const NODE_METHODS = new Set(["has_edge", "out", "in", "prop"]);
const NODE_DIRECT = new Set(["type", "id", "authority"]);

/* ───────────────────────── Tokenizer ───────────────────────── */

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "punc"; v: string }
  | { t: "eof" };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; let s = ""; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; } else { s += src[i]; i++; }
      }
      if (src[i] !== quote) throw new CelError(`unterminated string in: ${src}`);
      i++; toks.push({ t: "str", v: s }); continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let n = ""; while (i < src.length && /[0-9.]/.test(src[i]!)) { n += src[i]; i++; }
      toks.push({ t: "num", v: Number(n) }); continue;
    }
    if (isIdStart(c)) {
      let id = ""; while (i < src.length && isId(src[i]!)) { id += src[i]; i++; }
      toks.push({ t: "id", v: id }); continue;
    }
    const two = src.slice(i, i + 2);
    const matchedTwo = OPS.find((o) => o.length === 2 && o === two);
    if (matchedTwo) { toks.push({ t: "op", v: matchedTwo }); i += 2; continue; }
    if ("<>!".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if ("().,[]?:".includes(c)) { toks.push({ t: "punc", v: c }); i++; continue; }
    throw new CelError(`unexpected character '${c}' in: ${src}`);
  }
  toks.push({ t: "eof" });
  return toks;
}

/* ───────────────────────── AST ───────────────────────── */

type Node =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "list"; items: Node[] }
  | { k: "member"; obj: Node; name: string }
  | { k: "call"; callee: Node; args: Node[] }
  | { k: "unary"; op: string; e: Node }
  | { k: "binary"; op: string; l: Node; r: Node }
  | { k: "ternary"; c: Node; a: Node; b: Node };

/* ───────────────────────── Parser (Pratt) ───────────────────────── */

class Parser {
  private p = 0;
  constructor(private toks: Tok[], private src: string) {}
  private peek(): Tok { return this.toks[this.p]!; }
  private next(): Tok { return this.toks[this.p++]!; }
  private expect(v: string): void {
    const tk = this.next();
    if ((tk.t !== "punc" && tk.t !== "op") || tk.v !== v) {
      throw new CelError(`expected '${v}' in: ${this.src}`);
    }
  }
  private isPunc(v: string): boolean { const tk = this.peek(); return tk.t === "punc" && tk.v === v; }

  parse(): Node {
    const e = this.ternary();
    if (this.peek().t !== "eof") throw new CelError(`trailing tokens in: ${this.src}`);
    return e;
  }

  private ternary(): Node {
    const c = this.binary(0);
    if (this.isPunc("?")) {
      this.next();
      const a = this.ternary();
      this.expect(":");
      const b = this.ternary();
      return { k: "ternary", c, a, b };
    }
    return c;
  }

  // precedence: || < && < comparison/in
  private binary(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const tk = this.peek();
      const op = tk.t === "op" ? tk.v : tk.t === "id" && tk.v === "in" ? "in" : null;
      if (!op) break;
      const prec = this.prec(op);
      if (prec < minPrec || prec < 0) break;
      this.next();
      const right = this.binary(prec + 1);
      left = { k: "binary", op, l: left, r: right };
    }
    return left;
  }

  private prec(op: string): number {
    switch (op) {
      case "||": return 1;
      case "&&": return 2;
      case "==": case "!=": case "<": case "<=": case ">": case ">=": case "in": return 3;
      default: return -1;
    }
  }

  private unary(): Node {
    const tk = this.peek();
    if (tk.t === "op" && tk.v === "!") { this.next(); return { k: "unary", op: "!", e: this.unary() }; }
    return this.postfix(this.primary());
  }

  private postfix(base: Node): Node {
    let node = base;
    for (;;) {
      const tk = this.peek();
      if (tk.t === "punc" && tk.v === ".") {
        this.next();
        const name = this.next();
        if (name.t !== "id") throw new CelError(`expected member name in: ${this.src}`);
        node = { k: "member", obj: node, name: name.v };
      } else if (tk.t === "punc" && tk.v === "(") {
        this.next();
        const args: Node[] = [];
        if (!this.isPunc(")")) {
          args.push(this.ternary());
          while (this.isPunc(",")) { this.next(); args.push(this.ternary()); }
        }
        this.expect(")");
        node = { k: "call", callee: node, args };
      } else break;
    }
    return node;
  }

  private primary(): Node {
    const tk = this.next();
    if (tk.t === "num") return { k: "lit", v: tk.v };
    if (tk.t === "str") return { k: "lit", v: tk.v };
    if (tk.t === "id") {
      if (tk.v === "true") return { k: "lit", v: true };
      if (tk.v === "false") return { k: "lit", v: false };
      if (tk.v === "null") return { k: "lit", v: null };
      return { k: "id", name: tk.v };
    }
    if (tk.t === "punc" && tk.v === "(") { const e = this.ternary(); this.expect(")"); return e; }
    if (tk.t === "punc" && tk.v === "[") {
      const items: Node[] = [];
      if (!this.isPunc("]")) {
        items.push(this.ternary());
        while (this.isPunc(",")) { this.next(); items.push(this.ternary()); }
      }
      this.expect("]");
      return { k: "list", items };
    }
    throw new CelError(`unexpected token in: ${this.src}`);
  }
}

/* ───────────────────────── Runtime handles ───────────────────────── */

const MISSING = Symbol("missing");

class NodeHandle {
  constructor(private d: PcgNodeData, private pcg: PcgHandle) {}
  get type(): string { return this.d.type; }
  get id(): string { return this.d.id; }
  get authority(): unknown { return this.d.props?.["authority"]; }
  prop(name: string): unknown { return name in (this.d.props ?? {}) ? this.d.props![name] : MISSING; }
  sugar(name: string): unknown { return this.prop(name); }
  has_edge(edge: string): boolean { return (this.d.edges ?? []).some((e) => e.edge === edge); }
  out(edge: string): NodeHandle[] {
    return (this.d.edges ?? []).filter((e) => e.edge === edge)
      .map((e) => this.pcg.node(e.to)).filter((n): n is NodeHandle => n !== null);
  }
  in(edge: string): NodeHandle[] { return this.pcg.incoming(this.d.id, edge); }
}

class PcgHandle {
  private byId = new Map<string, PcgNodeData>();
  constructor(private g: ProjectContextGraph) {
    for (const n of g.nodes) this.byId.set(n.id, n);
  }
  attr(name: string): unknown { return name in this.g.attrs ? this.g.attrs[name] : MISSING; }
  has(type: string): boolean { return this.g.nodes.some((n) => n.type === type); }
  count(type: string): number { return this.g.nodes.filter((n) => n.type === type).length; }
  nodes(type: string): NodeHandle[] {
    return this.g.nodes.filter((n) => n.type === type).map((n) => new NodeHandle(n, this));
  }
  edge(subjectType: string, edge: string, objectType: string): number {
    let c = 0;
    for (const n of this.g.nodes) {
      if (n.type !== subjectType) continue;
      for (const e of n.edges ?? []) {
        const tgt = this.byId.get(e.to);
        if (e.edge === edge && tgt?.type === objectType) c++;
      }
    }
    return c;
  }
  node(id: string): NodeHandle | null {
    const d = this.byId.get(id);
    return d ? new NodeHandle(d, this) : null;
  }
  incoming(id: string, edge: string): NodeHandle[] {
    const out: NodeHandle[] = [];
    for (const n of this.g.nodes)
      if ((n.edges ?? []).some((e) => e.edge === edge && e.to === id)) out.push(new NodeHandle(n, this));
    return out;
  }
}

type Scope = Record<string, unknown>;

/* ───────────────────────── Evaluator ───────────────────────── */

class Evaluator {
  constructor(private pcg: PcgHandle, private src: string) {}

  eval(node: Node, scope: Scope): unknown {
    switch (node.k) {
      case "lit": return node.v;
      case "list": return node.items.map((n) => this.eval(n, scope));
      case "id": {
        if (node.name === "pcg") return this.pcg;
        if (node.name in scope) return scope[node.name];
        throw new CelError(`unknown identifier '${node.name}' in: ${this.src}`);
      }
      case "unary": {
        const v = this.eval(node.e, scope);
        return !this.truthy(v);
      }
      case "ternary":
        return this.truthy(this.eval(node.c, scope)) ? this.eval(node.a, scope) : this.eval(node.b, scope);
      case "binary": return this.binary(node, scope);
      case "member": return this.member(this.eval(node.obj, scope), node.name);
      case "call": return this.call(node, scope);
    }
  }

  private member(obj: unknown, name: string): unknown {
    if (obj instanceof PcgHandle) {
      if (PCG_METHODS.has(name)) throw new CelError(`pcg.${name} must be called, not used as a value in: ${this.src}`);
      const v = obj.attr(name); // sugar: pcg.motion
      if (v === MISSING) throw new IndeterminateError(`pcg.${name} not present`);
      return v;
    }
    if (obj instanceof NodeHandle) {
      if (NODE_METHODS.has(name)) throw new CelError(`node.${name} must be called, not used as a value in: ${this.src}`);
      if (NODE_DIRECT.has(name)) return (obj as unknown as Record<string, unknown>)[name];
      const v = obj.sugar(name); // sugar: n.rating
      if (v === MISSING) throw new IndeterminateError(`node.${name} not present`);
      return v;
    }
    throw new CelError(`cannot access .${name} on a non-object in: ${this.src}`);
  }

  private call(node: Node & { k: "call" }, scope: Scope): unknown {
    // has(expr): special form — tests presence without throwing Indeterminate.
    if (node.callee.k === "id" && node.callee.name === "has") {
      if (node.args.length !== 1) throw new CelError("has() takes one argument");
      try { this.eval(node.args[0]!, scope); return true; }
      catch (e) { if (e instanceof IndeterminateError) return false; throw e; }
    }
    if (node.callee.k !== "member") throw new CelError(`unsupported call in: ${this.src}`);

    const methodName = node.callee.name;
    // Macros: receiver.exists(ident, predicate) — second arg is an unevaluated lambda body.
    if (MACROS.has(methodName)) return this.macro(methodName, node.callee.obj, node.args, scope);

    const recvVal = this.eval(node.callee.obj, scope);
    const args = node.args.map((a) => this.eval(a, scope));
    return this.dispatch(recvVal, methodName, args);
  }

  private dispatch(recv: unknown, name: string, args: unknown[]): unknown {
    if (recv instanceof PcgHandle) {
      switch (name) {
        case "has": return recv.has(String(args[0]));
        case "count": return recv.count(String(args[0]));
        case "nodes": return recv.nodes(String(args[0]));
        case "edge": return recv.edge(String(args[0]), String(args[1]), String(args[2]));
        case "attr": { const v = recv.attr(String(args[0])); if (v === MISSING) throw new IndeterminateError(`attr ${String(args[0])}`); return v; }
        default: throw new CelError(`unknown pcg method '${name}' in: ${this.src}`);
      }
    }
    if (recv instanceof NodeHandle) {
      switch (name) {
        case "has_edge": return recv.has_edge(String(args[0]));
        case "out": return recv.out(String(args[0]));
        case "in": return recv.in(String(args[0]));
        case "prop": { const v = recv.prop(String(args[0])); if (v === MISSING) throw new IndeterminateError(`prop ${String(args[0])}`); return v; }
        default: throw new CelError(`unknown node method '${name}' in: ${this.src}`);
      }
    }
    throw new CelError(`'${name}' is not callable on this value in: ${this.src}`);
  }

  private macro(name: string, recvNode: Node, args: Node[], scope: Scope): unknown {
    if (args.length !== 2 || args[0]!.k !== "id") throw new CelError(`${name}() takes (ident, expr) in: ${this.src}`);
    const varName = (args[0] as { name: string }).name;
    const pred = args[1]!;
    const coll = this.eval(recvNode, scope);
    if (!Array.isArray(coll)) throw new CelError(`${name}() requires a list receiver in: ${this.src}`);
    const test = (el: unknown): boolean => {
      try { return this.truthy(this.eval(pred, { ...scope, [varName]: el })); }
      catch (e) { if (e instanceof IndeterminateError) return false; throw e; }
    };
    switch (name) {
      case "exists": return coll.some(test);
      case "all": return coll.every(test);
      case "exists_one": return coll.filter(test).length === 1;
      case "filter": return coll.filter(test);
    }
  }

  private binary(node: Node & { k: "binary" }, scope: Scope): unknown {
    const { op } = node;
    if (op === "&&") return this.truthy(this.eval(node.l, scope)) && this.truthy(this.eval(node.r, scope));
    if (op === "||") return this.truthy(this.eval(node.l, scope)) || this.truthy(this.eval(node.r, scope));
    const l = this.eval(node.l, scope);
    const r = this.eval(node.r, scope);
    switch (op) {
      case "==": return l === r;
      case "!=": return l !== r;
      case "<": return (l as number) < (r as number);
      case "<=": return (l as number) <= (r as number);
      case ">": return (l as number) > (r as number);
      case ">=": return (l as number) >= (r as number);
      case "in": return Array.isArray(r) && r.includes(l);
    }
    throw new CelError(`unknown operator ${op}`);
  }

  private truthy(v: unknown): boolean {
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    return Boolean(v);
  }
}

/** Parse + statically check an expression. Throws CelError if out of profile. */
export function parse(expr: string): Node {
  return new Parser(tokenize(expr), expr).parse();
}

/**
 * Evaluate an applies_when condition against a PCG.
 * Throws IndeterminateError if a referenced attr/prop is missing (caller decides
 * fail-active vs fail-inactive by severity, per spec §5.3).
 */
export function evaluate(expr: string, pcg: ProjectContextGraph): boolean {
  const ast = parse(expr);
  const ev = new Evaluator(new PcgHandle(pcg), expr);
  const result = ev.eval(ast, {});
  if (typeof result !== "boolean") throw new CelError(`condition did not return boolean: ${expr}`);
  return result;
}

/** Extract the string-literal node types referenced via pcg.nodes()/has()/count() — for validation. */
export function referencedTypes(expr: string): string[] {
  const ast = parse(expr);
  const out = new Set<string>();
  const walk = (n: Node): void => {
    if (n.k === "call" && n.callee.k === "member" &&
        ["nodes", "has", "count"].includes(n.callee.name) &&
        n.callee.obj.k === "id" && n.callee.obj.name === "pcg") {
      const a = n.args[0];
      if (a && a.k === "lit" && typeof a.v === "string") out.add(a.v);
    }
    switch (n.k) {
      case "list": n.items.forEach(walk); break;
      case "member": walk(n.obj); break;
      case "call": walk(n.callee); n.args.forEach(walk); break;
      case "unary": walk(n.e); break;
      case "binary": walk(n.l); walk(n.r); break;
      case "ternary": walk(n.c); walk(n.a); walk(n.b); break;
    }
  };
  walk(ast);
  return [...out];
}
