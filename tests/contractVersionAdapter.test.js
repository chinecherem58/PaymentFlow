'use strict';

/**
 * Tests for issue #633 — Contract Version Adapter
 *
 * Verifies that the event parser correctly adapts events from different
 * schema versions to a consistent internal representation, and that the
 * system can handle both v1 and v2 schemas simultaneously without confusion.
 */

jest.mock('../backend/src/utils/logger', () => {
  const noop = () => {};
  const logger = { info: noop, warn: jest.fn(), error: jest.fn(), debug: noop };
  logger.child = () => logger;
  return logger;
});

const { parseEvent, parseEvents } = require('../backend/src/soroban/eventParser');
const { LATEST_SCHEMA_VERSION }   = require('../backend/src/soroban/eventSchemas');

// ── Adapter contract tests ────────────────────────────────────────────────────

describe('contractVersionAdapter — normalised event shape', () => {
  const makeV1 = (overrides = {}) => ({
    schema_version: 1,
    event_type:     'fee_paid',
    contract_id:    'CCAAA',
    timestamp:      '2024-01-01T00:00:00.000Z',
    payload:        {},
    ...overrides,
  });

  const makeV2 = (overrides = {}) => ({
    schema_version: 2,
    event_type:     'fee_paid',
    contract_id:    'CCAAA',
    timestamp:      '2024-06-01T00:00:00.000Z',
    payload:        {},
    tx_hash:        'a'.repeat(64),
    ledger_seq:     12345,
    ...overrides,
  });

  test('v1 and v2 parsed events share the same top-level keys', () => {
    const v1Result = parseEvent(makeV1());
    const v2Result = parseEvent(makeV2());

    const v1Keys = Object.keys(v1Result).sort();
    const v2Keys = Object.keys(v2Result).sort();

    // Both must expose the same set of keys so downstream code can handle
    // both versions with the same access patterns.
    expect(v1Keys).toEqual(v2Keys);
  });

  test('v1 event parsed with schemaVersion 1', () => {
    expect(parseEvent(makeV1()).schemaVersion).toBe(1);
  });

  test('v2 event parsed with schemaVersion 2', () => {
    expect(parseEvent(makeV2()).schemaVersion).toBe(2);
  });

  test('v1 txHash is null, v2 txHash is populated', () => {
    expect(parseEvent(makeV1()).txHash).toBeNull();
    expect(parseEvent(makeV2()).txHash).toBe('a'.repeat(64));
  });

  test('v1 ledgerSeq is null, v2 ledgerSeq is a number', () => {
    expect(parseEvent(makeV1()).ledgerSeq).toBeNull();
    expect(parseEvent(makeV2()).ledgerSeq).toBe(12345);
  });

  test('a batch of mixed-version events is fully parsed — none dropped', () => {
    const events = [makeV1(), makeV2(), makeV1(), makeV2()];
    const results = parseEvents(events);
    expect(results).toHaveLength(4);
    // No event should be silently dropped; errored ones get parse_error: true
    results.forEach((r) => expect(r).toBeTruthy());
  });

  test('parse_error events include the original raw event for recovery', () => {
    const unknown = { schema_version: 50, event_type: 'x', contract_id: 'y' };
    const result = parseEvent(unknown);
    expect(result.parse_error).toBe(true);
    expect(result.raw).toEqual(unknown);
  });
});

describe('contractVersionAdapter — LATEST_SCHEMA_VERSION', () => {
  test('LATEST_SCHEMA_VERSION is a positive integer', () => {
    expect(typeof LATEST_SCHEMA_VERSION).toBe('number');
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  test('LATEST_SCHEMA_VERSION is at least 2', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});
