/**
 * 极小安全表达式求值器 —— 判定 DSL 中 matcherType='js-expression' 的真实语义。
 *
 * 设计目标：让模板作者能写 `/PASS/.test(output) && !/FAIL/.test(output)`
 * 这类判定表达式，同时绝不触碰 eval/Function/全局对象。
 *
 * 支持（白名单）：
 * - 字面量：数字 / 单双引号字符串 / true false null / 正则 /pattern/flags
 * - 变量：调用方注入的 vars（约定 output: string、exitCode: number）
 * - 运算：&& || ! == != === !== < <= > >= + - * / % 与括号
 * - 成员：.length；方法：test/includes/match/trim/toUpperCase/toLowerCase/toString
 *
 * 不支持即报错：赋值、new、属性写入、未知标识符、未知方法、模板字符串等。
 */

interface Token {
  type: 'num' | 'str' | 'regex' | 'ident' | 'punct';
  value: string;
  flags?: string;
}

const PUNCTS = [
  '===', '!==', '&&', '||',
  '==', '!=', '<=', '>=',
  '(', ')', '[', ']', '{', '}', '.', ',', ';', ':', '?',
  '+', '-', '*', '/', '%', '!', '<', '>', '=',
];

const ALLOWED_METHODS = new Set(['test', 'includes', 'match', 'trim', 'toUpperCase', 'toLowerCase', 'toString']);
const ALLOWED_PROPS = new Set(['length']);

export interface EvalOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    // 数字
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      tokens.push({ type: 'num', value: src.slice(i, j).replace(/_/g, '') });
      i = j;
      continue;
    }
    // 字符串
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') { out += unescapeChar(src[j + 1] ?? ''); j += 2; }
        else out += src[j++];
      }
      if (j >= src.length) throw new Error('字符串未闭合');
      tokens.push({ type: 'str', value: out });
      i = j + 1;
      continue;
    }
    // 正则字面量：/ 开头且不在「除法/前一个 token 可接二元运算」位置。
    // 简化启发式：前一 token 是 ident/num/str/regex 或 ')' 时按除号处理，否则按正则。
    if (ch === '/' && !prevEndsValue(tokens)) {
      let j = i + 1;
      let body = '';
      let inClass = false;
      while (j < src.length && (src[j] !== '/' || inClass)) {
        if (src[j] === '\\') { body += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        body += src[j++];
      }
      if (j >= src.length) throw new Error('正则未闭合');
      let k = j + 1;
      let flags = '';
      while (k < src.length && /[gimsuy]/.test(src[k])) flags += src[k++];
      new RegExp(body, flags); // 提前验证合法性
      tokens.push({ type: 'regex', value: body, flags });
      i = k;
      continue;
    }
    // 标识符/关键字
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    // 操作符
    const punct = PUNCTS.find((p) => src.startsWith(p, i));
    if (!punct) throw new Error(`无法识别的字符: "${ch}"`);
    tokens.push({ type: 'punct', value: punct });
    i += punct.length;
  }
  return tokens;
}

function prevEndsValue(tokens: Token[]): boolean {
  const t = tokens[tokens.length - 1];
  return !!t && (t.type === 'num' || t.type === 'str' || t.type === 'regex' ||
    (t.type === 'ident' && t.value !== 'true' && t.value !== 'false' && t.value !== 'null') ||
    (t.type === 'punct' && (t.value === ')' || t.value === ']')));
}

function unescapeChar(c: string): string {
  switch (c) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    default: return c;
  }
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly vars: Record<string, unknown>) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token { const t = this.tokens[this.pos++]; if (!t) throw new Error('表达式意外结束'); return t; }
  private eatPunct(v: string): boolean {
    const t = this.peek();
    if (t && t.type === 'punct' && t.value === v) { this.pos++; return true; }
    return false;
  }

  parse(): unknown {
    const v = this.parseOr();
    if (this.pos < this.tokens.length) throw new Error(`存在未消费的输入: ${this.tokens[this.pos].value}`);
    return v;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.eatPunct('||')) {
      const right = this.parseAnd();
      left = truthy(left) ? left : right; // 与 JS 一致：返回决定值
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseEquality();
    while (this.eatPunct('&&')) {
      const right = this.parseEquality();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private parseEquality(): unknown {
    let left = this.parseComparison();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'punct' && ['===', '==', '!==', '!='].includes(t.value)) {
        this.pos++;
        const right = this.parseComparison();
        switch (t.value) {
          case '===': case '==': left = left === right || (left == null && right == null); break;
          default: left = !(left === right || (left == null && right == null));
        }
      } else break;
    }
    return left;
  }

  private parseComparison(): unknown {
    let left = this.parseAdditive();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'punct' && ['<', '<=', '>', '>='].includes(t.value)) {
        this.pos++;
        const right = this.parseAdditive();
        const l = Number(left), r = Number(right);
        if ([l, r].some(Number.isNaN) && (typeof left === 'string') === false && (typeof right === 'string') === false)
          throw new Error('比较运算需要数字或字符串');
        switch (t.value) {
          case '<': left = l < r; break;
          case '<=': left = l <= r; break;
          case '>': left = l > r; break;
          default: left = l >= r;
        }
      } else break;
    }
    return left;
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eatPunct('+')) {
        const right = this.parseMultiplicative();
        if ((typeof left === 'object' && left !== null) || (typeof right === 'object' && right !== null))
          throw new Error('+ 不支持对象');
        left = typeof left === 'string' || typeof right === 'string'
          ? String(left) + String(right)
          : Number(left) + Number(right);
      } else if (this.eatPunct('-')) {
        const right = this.parseMultiplicative();
        left = Number(left) - Number(right);
      } else break;
    }
    return left;
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    for (;;) {
      if (this.eatPunct('*')) left = Number(left) * Number(this.parseUnary());
      else if (this.eatPunct('/')) left = Number(left) / Number(this.parseUnary());
      else if (this.eatPunct('%')) left = Number(left) % Number(this.parseUnary());
      else break;
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.eatPunct('!')) return !truthy(this.parseUnary());
    if (this.eatPunct('-')) return -Number(this.parseUnary());
    return this.parsePostfix();
  }

  /** 成员访问与方法调用（白名单内） */
  private parsePostfix(): unknown {
    let base = this.parsePrimary();
    for (;;) {
      if (this.eatPunct('.')) {
        const t = this.next();
        if (t.type !== 'ident') throw new Error('. 后必须是标识符');
        if (this.eatPunct('(')) {
          if (!ALLOWED_METHODS.has(t.value)) throw new Error(`方法不在白名单: .${t.value}()`);
          const args: unknown[] = [];
          if (!this.eatPunct(')')) {
            do { args.push(this.parseOr()); } while (this.eatPunct(','));
            if (!this.eatPunct(')')) throw new Error('括号未闭合');
          }
          base = callMethod(base, t.value, args);
        } else {
          if (!ALLOWED_PROPS.has(t.value)) throw new Error(`属性不在白名单: .${t.value}`);
          base = propertyOf(base, t.value);
        }
      } else break;
    }
    return base;
  }

  private parsePrimary(): unknown {
    const t = this.next();
    if (t.type === 'num') return Number(t.value);
    if (t.type === 'str') return t.value;
    if (t.type === 'regex') return new RegExp(t.value, t.flags);
    if (t.type === 'ident') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      if (t.value === 'output') return this.vars.output ?? '';
      if (t.value === 'exitCode') return this.vars.exitCode ?? 0;
      throw new Error(`未知标识符: ${t.value}（可用变量: output, exitCode）`);
    }
    if (t.type === 'punct' && t.value === '(') {
      const v = this.parseOr();
      if (!this.eatPunct(')')) throw new Error('括号未闭合');
      return v;
    }
    throw new Error(`意外的 token: ${t.value}`);
  }
}

function truthy(v: unknown): boolean {
  return Boolean(v);
}

function callMethod(base: unknown, method: string, args: unknown[]): unknown {
  if (base instanceof RegExp) {
    if (method === 'test') return base.test(String(args[0] ?? ''));
  }
  if (typeof base === 'string') {
    switch (method) {
      case 'includes': return base.includes(String(args[0] ?? ''));
      case 'match': return base.match(args[0] instanceof RegExp ? args[0] : new RegExp(String(args[0] ?? '')));
      case 'trim': return base.trim();
      case 'toUpperCase': return base.toUpperCase();
      case 'toLowerCase': return base.toLowerCase();
      case 'toString': return base;
    }
  }
  throw new Error(`不支持在 ${typeof base} 上调用 .${method}()`);
}

function propertyOf(base: unknown, prop: string): unknown {
  if (prop === 'length') {
    if (typeof base === 'string' || Array.isArray(base)) return base.length;
  }
  throw new Error(`不支持读取 .${prop}`);
}

/** 求值入口：任何语法/白名单/运行时错误都收敛为 {ok:false}，绝不抛出 */
export function evaluateExpression(expr: string, vars: Record<string, unknown> = {}): EvalOutcome {
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return { ok: false, error: '空表达式' };
    const value = new Parser(tokens, vars).parse();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
