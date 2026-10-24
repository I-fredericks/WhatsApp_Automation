const assert = require('assert');
const { describe, it } = require('node:test');
const {
  sanitizePhoneNumber,
  parseNumberList,
  randomInt,
  formatWhatsAppId,
} = require('../src/utils');

describe('utils', () => {
  describe('sanitizePhoneNumber', () => {
    it('removes non-digit characters', () => {
      assert.strictEqual(sanitizePhoneNumber('+90 555 123 45 67'), '905551234567');
      assert.strictEqual(sanitizePhoneNumber('(1415) 555-1234'), '14155551234');
    });

    it('returns null for short inputs', () => {
      assert.strictEqual(sanitizePhoneNumber('123'), null);
      assert.strictEqual(sanitizePhoneNumber(''), null);
    });
  });

  describe('parseNumberList', () => {
    it('parses one number per line and skips invalid lines', () => {
      const input = '+90 555 111 22 33\nabc\n+44 7700 900123\n\n12\n';
      const numbers = parseNumberList(input);
      assert.deepStrictEqual(numbers, ['905551112233', '447700900123']);
    });
  });

  describe('randomInt', () => {
    it('returns a value within the inclusive range', () => {
      for (let i = 0; i < 100; i++) {
        const value = randomInt(10, 20);
        assert.ok(value >= 10 && value <= 20, `value ${value} out of range`);
      }
    });
  });

  describe('formatWhatsAppId', () => {
    it('appends @c.us suffix', () => {
      assert.strictEqual(formatWhatsAppId('905551234567'), '905551234567@c.us');
    });
  });
});
