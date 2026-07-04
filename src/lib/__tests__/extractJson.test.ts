import { extractJson } from '../extractJson';

describe('extractJson', () => {
  it('extracts valid JSON from a plain string', () => {
    expect(extractJson('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('extracts JSON with surrounding prose', () => {
    expect(extractJson('Here is the output: {"key": "value"} end')).toEqual({ key: 'value' });
  });

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"key": "value"}\n```')).toEqual({ key: 'value' });
  });

  it('strips plain ``` fences', () => {
    expect(extractJson('```\n{"key": "value"}\n```')).toEqual({ key: 'value' });
  });

  it('handles nested objects', () => {
    expect(extractJson('{"outer": {"inner": 42}}')).toEqual({ outer: { inner: 42 } });
  });

  it('returns null when there are no braces', () => {
    expect(extractJson('no json here')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJson('{invalid: json}')).toBeNull();
  });
});
