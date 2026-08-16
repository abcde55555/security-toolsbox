import { describe, it, expect } from 'vitest';
import {
  renderCommandTemplate,
  extractPlaceholders,
  validateFormValues,
  toolCommandSchema,
  customToolCreateSchema,
} from '@en18031/shared';
import './helpers.js';

describe('renderCommandTemplate', () => {
  it('renders safe values without quotes', () => {
    const r = renderCommandTemplate('ping -c {{count}} {{target}}', {
      count: 1,
      target: '127.0.0.1',
    });
    expect(r.command).toBe('ping -c 1 127.0.0.1');
    expect(r.missing).toEqual([]);
    expect(r.unused).toEqual([]);
  });

  it('quotes values containing shell metacharacters / spaces', () => {
    const r = renderCommandTemplate('echo {{msg}}', { msg: 'hello; rm -rf /' });
    expect(r.command).toBe("echo 'hello; rm -rf /'");
  });

  it('escapes single quotes inside values', () => {
    const r = renderCommandTemplate('echo {{msg}}', { msg: "it's" });
    expect(r.command).toBe("echo 'it'\\''s'");
  });

  it('injects raw keys verbatim', () => {
    const r = renderCommandTemplate('nc {{extra}} 127.0.0.1', { extra: '-vz -w 3' }, { rawKeys: ['extra'] });
    expect(r.command).toBe('nc -vz -w 3 127.0.0.1');
  });

  it('reports missing and unused params', () => {
    const r = renderCommandTemplate('ping {{target}}', { count: 4 });
    expect(r.missing).toEqual(['target']);
    expect(r.unused).toEqual(['count']);
  });

  it('stringifies booleans and space-joins arrays with quoting', () => {
    const r = renderCommandTemplate('cmd {{flag}} {{items}}', {
      flag: true,
      items: ['a b', 'c'],
    });
    expect(r.command).toBe("cmd true 'a b' c");
  });
});

describe('extractPlaceholders', () => {
  it('returns unique placeholders', () => {
    expect(extractPlaceholders('{{a}}-{{b}}-{{a}}')).toEqual(['a', 'b']);
  });
});

describe('validateFormValues', () => {
  it('enforces required fields', () => {
    const errs = validateFormValues([{ id: 'target', label: 't', type: 'text', required: true }], {});
    expect(errs.target).toContain('必填');
  });

  it('validates ip format', () => {
    const errs = validateFormValues(
      [{ id: 'ip', label: 'ip', type: 'text', format: 'ip' }],
      { ip: '999.1.1.1' },
    );
    expect(errs.ip).toBeTruthy();
    expect(validateFormValues(
      [{ id: 'ip', label: 'ip', type: 'text', format: 'ip' }],
      { ip: '10.0.0.1' },
    )).toEqual({});
  });

  it('validates number min/max', () => {
    const errs = validateFormValues(
      [{ id: 'n', label: 'n', type: 'number', min: 1, max: 20 }],
      { n: 100 },
    );
    expect(errs.n).toContain('20');
  });
});

describe('toolCommandSchema', () => {
  it('rejects a placeholder without a matching param', () => {
    const r = toolCommandSchema.safeParse({
      id: 'c',
      name: 'c',
      commandTemplate: 'ping {{target}}',
      params: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate param ids', () => {
    const r = toolCommandSchema.safeParse({
      id: 'c',
      name: 'c',
      commandTemplate: 'ping {{target}}',
      params: [
        { id: 'target', label: 't', type: 'text' },
        { id: 'target', label: 't2', type: 'text' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid command', () => {
    const r = toolCommandSchema.safeParse({
      id: 'c',
      name: 'c',
      commandTemplate: 'ping -c {{count}} {{target}}',
      params: [
        { id: 'count', label: 'c', type: 'number', value: 1 },
        { id: 'target', label: 't', type: 'text', value: '127.0.0.1' },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('customToolCreateSchema', () => {
  it('defaults type/interactionMode/version/category/commands', () => {
    const r = customToolCreateSchema.parse({ name: 'x' });
    expect(r.type).toBe('custom');
    expect(r.interactionMode).toBe('cmd');
    expect(r.version).toBe('1.0.0');
    expect(r.category).toBe('other');
    expect(r.commands).toEqual([]);
    expect(r.tags).toEqual([]);
  });
});
