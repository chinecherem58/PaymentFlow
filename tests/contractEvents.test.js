'use strict';

/**
 * Tests for issue #633 — Contract Event Parser
 *
 * Verifies that:
 *  1. v1 events are parsed correctly
 *  2. v2 events are parsed correctly with the new fields
 *  3. Both schema versions are handled simultaneously
 *  4. Unknown schema_version is logged as a warning and returned with parse_error: true
 *  5. Events missing schema_version are not silently dropped
 */

jest.mock('../backend/src/utils/logger', () => {
  const noop = () => {};
  const logger = { info: noop, warn: jest.fn(), error: jest.fn(), debug: noop };
  logger.child = () => logger;
  return logger;
});

const { parseEvent, parseEvents } = require('../backend/src/soroban/eventParser');
const logger = require('../backend/src/utils/logger');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const V1_EVENT = {
  schema_version: 1,
  event_type:     'payment_confirmed',
  contract_id:    'CCBUSXG7VHO5RGNLBKJCBFGQGWQHQPNPQKZXYSWVFJNLPZGXYGXZUAAA',
  timestamp:      '2024-01-01T00:00:00.000Z',
  payload:        { amount: '100', currency: 'USDC' },
};

const V2_EVENT = {
  schema_version: 2,
  event_type:     'payment_confirmed',
  contract_id:    'CCBUSXG7VHO5RGNLBKJCBFGQGWQHQPNPQKZXYSWVFJNLPZGXYGXZUAAA',
  timestamp:      '2024-06-01T00:00:00.000Z',
  payload:        { amount: '200', currency: 'USDC' },
  tx_hash:        'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
  ledger_seq:     55000,
};

// ── parseEvent — v1 ───────────────────────────────────────────────────────────

describe('parseEvent() — v1 schema', () => {
  test('parses a valid v1 event without error', () => {
    const result = parseEvent(V1_EVENT);
    expect(result.parse_error).toBeUndefined();
    expect(result.schemaVersion).toBe(1);
  });

  test('maps event_type to eventType', () => {
    expect(parseEvent(V1_EVENT).eventType).toBe('payment_confirmed');
  });

  test('maps contract_id to contractId', () => {
    expect(parseEvent(V1_EVENT).contractId).toBe(V1_EVENT.contract_id);
  });

  test('preserves payload', () => {
    expect(parseEvent(V1_EVENT).payload).toEqual(V1_EVENT.payload);
  });

  test('sets txHash and ledgerSeq to null for v1 events', () => {
    const result = parseEvent(V1_EVENT);
    expect(result.txHash).toBeNull();
    expect(result.ledgerSeq).toBeNull();
  });
});

// ── parseEvent — v2 ───────────────────────────────────────────────────────────

describe('parseEvent() — v2 schema', () => {
  test('parses a valid v2 event without error', () => {
    const result = parseEvent(V2_EVENT);
    expect(result.parse_error).toBeUndefined();
    expect(result.schemaVersion).toBe(2);
  });

  test('maps tx_hash to txHash', () => {
    expect(parseEvent(V2_EVENT).txHash).toBe(V2_EVENT.tx_hash);
  });

  test('maps ledger_seq to ledgerSeq as a number', () => {
    expect(parseEvent(V2_EVENT).ledgerSeq).toBe(55000);
  });

  test('carries forward all v1 fields', () => {
    const result = parseEvent(V2_EVENT);
    expect(result.eventType).toBe('payment_confirmed');
    expect(result.contractId).toBe(V2_EVENT.contract_id);
    expect(result.payload).toEqual(V2_EVENT.payload);
  });
});

// ── Simultaneous v1 + v2 handling ────────────────────────────────────────────

describe('parseEvents() — mixed v1 and v2 events', () => {
  test('parses a mixed array and returns results for every event', () => {
    const results = parseEvents([V1_EVENT, V2_EVENT]);
    expect(results).toHaveLength(2);
    expect(results[0].schemaVersion).toBe(1);
    expect(results[1].schemaVersion).toBe(2);
  });

  test('returns an empty array for a non-array input', () => {
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents('not-an-array')).toEqual([]);
  });
});

// ── Unknown schema_version ────────────────────────────────────────────────────

describe('parseEvent() — unknown schema_version', () => {
  beforeEach(() => logger.warn.mockClear());

  test('returns parse_error: true for an unknown version', () => {
    const result = parseEvent({ schema_version: 99, event_type: 'foo', contract_id: 'bar' });
    expect(result.parse_error).toBe(true);
    expect(result.reason).toMatch(/unknown schema_version/);
  });

  test('logs a warning for an unknown schema_version (not silently dropped)', () => {
    parseEvent({ schema_version: 99, event_type: 'foo', contract_id: 'bar' });
    expect(logger.warn).toHaveBeenCalled();
    const warnArg = logger.warn.mock.calls[0][0];
    expect(warnArg).toMatch(/unknown schema_version/i);
  });

  test('includes the raw event in the parse_error result', () => {
    const raw = { schema_version: 99, event_type: 'foo' };
    const result = parseEvent(raw);
    expect(result.raw).toBe(raw);
  });

  test('preserves the unknown version number in the result', () => {
    const result = parseEvent({ schema_version: 99, event_type: 'x', contract_id: 'y' });
    expect(result.schemaVersion).toBe(99);
  });
});

// ── Missing schema_version ────────────────────────────────────────────────────

describe('parseEvent() — missing schema_version', () => {
  beforeEach(() => logger.warn.mockClear());

  test('returns parse_error: true when schema_version is absent', () => {
    const result = parseEvent({ event_type: 'payment_confirmed', contract_id: 'CCC' });
    expect(result.parse_error).toBe(true);
    expect(result.reason).toMatch(/missing schema_version/);
  });

  test('logs a warning when schema_version is absent', () => {
    parseEvent({ event_type: 'payment_confirmed' });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('returns parse_error: true for a null/undefined input', () => {
    expect(parseEvent(null).parse_error).toBe(true);
    expect(parseEvent(undefined).parse_error).toBe(true);
  });
});
