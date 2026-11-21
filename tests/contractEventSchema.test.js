'use strict';

/**
 * Tests for issue #633 — Contract Event Schema Versioning
 *
 * Verifies the schema definitions and that version constants are correct.
 */

const {
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMAS,
  LATEST_SCHEMA_VERSION,
} = require('../backend/src/soroban/eventSchemas');

describe('eventSchemas — SCHEMA_V1', () => {
  test('has version 1', () => {
    expect(SCHEMA_V1.version).toBe(1);
  });

  test('includes schema_version in fields', () => {
    expect(SCHEMA_V1.fields).toContain('schema_version');
  });

  test('requires schema_version, event_type, contract_id', () => {
    expect(SCHEMA_V1.required).toEqual(
      expect.arrayContaining(['schema_version', 'event_type', 'contract_id'])
    );
  });
});

describe('eventSchemas — SCHEMA_V2', () => {
  test('has version 2', () => {
    expect(SCHEMA_V2.version).toBe(2);
  });

  test('extends v1 fields with tx_hash and ledger_seq', () => {
    expect(SCHEMA_V2.fields).toContain('tx_hash');
    expect(SCHEMA_V2.fields).toContain('ledger_seq');
  });

  test('carries forward all v1 fields', () => {
    for (const field of SCHEMA_V1.fields) {
      expect(SCHEMA_V2.fields).toContain(field);
    }
  });

  test('requires tx_hash in addition to v1 required fields', () => {
    expect(SCHEMA_V2.required).toContain('tx_hash');
    for (const field of SCHEMA_V1.required) {
      expect(SCHEMA_V2.required).toContain(field);
    }
  });
});

describe('eventSchemas — SCHEMAS registry', () => {
  test('SCHEMAS[1] is SCHEMA_V1', () => {
    expect(SCHEMAS[1]).toBe(SCHEMA_V1);
  });

  test('SCHEMAS[2] is SCHEMA_V2', () => {
    expect(SCHEMAS[2]).toBe(SCHEMA_V2);
  });

  test('LATEST_SCHEMA_VERSION matches the highest key in SCHEMAS', () => {
    const max = Math.max(...Object.keys(SCHEMAS).map(Number));
    expect(LATEST_SCHEMA_VERSION).toBe(max);
  });
});
