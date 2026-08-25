import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../services/safeExpression.js';

const ok = (v: unknown) => ({ ok: true as const, value: v });

describe('safeExpression —— js-expression 判定 DSL 的受限求值器', () => {
  it('正则 test 与逻辑组合（典型判定表达式）', () => {
    const vars = { output: 'handshake OK\nPASS\nno errors', exitCode: 0 };
    expect(evaluateExpression('/PASS/.test(output)', vars)).toEqual(ok(true));
    expect(evaluateExpression('/PASS/.test(output) && !/FAIL/.test(output)', vars)).toEqual(ok(true));
    expect(evaluateExpression('/FAIL/.test(output) || exitCode !== 0', vars)).toEqual(ok(false));
  });

  it('includes / match / length / trim 等白名单方法', () => {
    const vars = { output: '  BLE connected  ', exitCode: 0 };
    expect(evaluateExpression('output.includes("connected")', vars)).toEqual(ok(true));
    expect(evaluateExpression('output.trim().length > 0', vars)).toEqual(ok(true));
    expect(evaluateExpression('/(\\d+) ms/.test(output) === false', vars)).toEqual(ok(true));
  });

  it('比较与算术', () => {
    expect(evaluateExpression('exitCode == 0', { output: '', exitCode: 0 })).toEqual(ok(true));
    expect(evaluateExpression('exitCode >= 1 && exitCode <= 3', { output: '', exitCode: 2 })).toEqual(ok(true));
    expect(evaluateExpression('(1 + 2) * 3 === 9', { output: '' })).toEqual(ok(true));
    expect(evaluateExpression('"a" + "b" === "ab"', {})).toEqual(ok(true));
  });

  it('|| && 返回决定值（与 JS 一致）', () => {
    expect(evaluateExpression('null || "x"', {})).toEqual(ok('x'));
    expect(evaluateExpression('"y" && "z"', {})).toEqual(ok('z'));
  });

  it('未知标识符被拒绝并给出可用变量提示', () => {
    const r = evaluateExpression('secret.length > 0', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('output');
  });

  it('注入面：new/赋值/全局对象/模板字符串均不可用', () => {
    for (const expr of [
      'new Date()',
      'globalThis.output',
      'this.output',
      'process.exit',
      'output = "x"',
      'constructor.constructor("return 1")()',
      '`backtick`',
      'output.__proto__',
      'Function("return 1")',
    ]) {
      const r = evaluateExpression(expr, { output: 'x' });
      expect(r.ok, `${expr} 应被拒绝`).toBe(false);
    }
  });

  it('语法错误安全收敛为 ok:false 而非抛出', () => {
    for (const expr of ['', '/unclosed', '"unclosed', '1 +', 'a.b.c']) {
      expect(evaluateExpression(expr, {}).ok).toBe(false);
    }
  });
});
