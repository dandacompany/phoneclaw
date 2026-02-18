import { describe, it, expect } from 'vitest';
import { escapeXml, formatMessages, stripInternalTags } from './router.js';

describe('escapeXml', () => {
  it('XML 특수문자를 이스케이프한다', () => {
    expect(escapeXml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('& 문자를 이스케이프한다', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('일반 텍스트는 그대로 반환한다', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});

describe('formatMessages', () => {
  it('메시지 배열을 XML 형식으로 포매팅한다', () => {
    const result = formatMessages([
      { id: '1', chatId: 'tg:123', senderId: 'u1', senderName: 'Alice', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
    ]);
    expect(result).toContain('<messages>');
    expect(result).toContain('sender="Alice"');
    expect(result).toContain('Hello');
    expect(result).toContain('</messages>');
  });

  it('빈 배열도 처리한다', () => {
    const result = formatMessages([]);
    expect(result).toContain('<messages>');
    expect(result).toContain('</messages>');
  });

  it('특수문자가 포함된 메시지를 안전하게 처리한다', () => {
    const result = formatMessages([
      { id: '1', chatId: 'tg:123', senderId: 'u1', senderName: '<Admin>', content: 'a & b', timestamp: '2026-01-01T00:00:00Z' },
    ]);
    expect(result).toContain('sender="&lt;Admin&gt;"');
    expect(result).toContain('a &amp; b');
  });
});

describe('stripInternalTags', () => {
  it('<internal> 태그를 제거한다', () => {
    expect(stripInternalTags('Hello <internal>secret</internal> World')).toBe('Hello  World');
  });

  it('멀티라인 internal 태그를 제거한다', () => {
    expect(stripInternalTags('Start\n<internal>\nline1\nline2\n</internal>\nEnd')).toBe('Start\n\nEnd');
  });

  it('internal 태그가 없으면 그대로 반환한다', () => {
    expect(stripInternalTags('Hello World')).toBe('Hello World');
  });
});
