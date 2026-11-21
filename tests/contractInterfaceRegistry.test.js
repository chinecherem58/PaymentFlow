'use strict';

/**
 * Tests for issue #636 — Contract Interface Registry
 *
 * Verifies:
 *  1. loadRegistry() parses a valid registry and returns an array
 *  2. resolveContract() selects the latest active entry for a given network
 *  3. Invalid registry entries (missing fields, bad formats) throw descriptive errors
 *  4. validateRegistryOnStartup() fails fast on a corrupt registry
 *  5. getActiveContract() respects the STELLAR_NETWORK env var
 */

const path = require('path');
const fs   = require('fs');

// We mock `fs` so no real file I/O happens in tests.
jest.mock('fs');

const {
  loadRegistry,
  validateEntry,
  resolveContract,
  validateRegistryOnStartup,
  getActiveContract,
} = require('../backend/src/services/contractRegistryService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_ENTRY_TESTNET = {
  network:    'testnet',
  contractId: 'CCBUSXG7VHO5RGNLBKJCBFGQGWQHQPNPQKZXYSWVFJNLPZGXYGXZUAAA',
  wasmHash:   'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  abiVersion: '1.0.0',
  deployedAt: '2024-01-01T00:00:00.000Z',
  active:     true,
};

const VALID_ENTRY_MAINNET = {
  network:    'mainnet',
  contractId: 'CCBUSXG7VHO5RGNLBKJCBFGQGWQHQPNPQKZXYSWVFJNLPZGXYGXZUAAB',
  wasmHash:   'a3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856',
  abiVersion: '1.0.0',
  deployedAt: '2024-02-01T00:00:00.000Z',
  active:     true,
};

const VALID_ENTRY_TESTNET_V2 = {
  ...VALID_ENTRY_TESTNET,
  contractId: 'CCBUSXG7VHO5RGNLBKJCBFGQGWQHQPNPQKZXYSWVFJNLPZGXYGXZUAAC',
  wasmHash:   'b3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b857',
  abiVersion: '2.0.0',
  deployedAt: '2024-06-01T00:00:00.000Z',
  active:     true,
};

function mockRegistryFile(entries) {
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(entries));
}

function mockMissingFile() {
  fs.existsSync.mockReturnValue(false);
}

// ── loadRegistry ─────────────────────────────────────────────────────────────

describe('loadRegistry()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null when registry file does not exist', () => {
    mockMissingFile();
    expect(loadRegistry()).toBeNull();
  });

  test('returns a parsed array for a valid registry', () => {
    mockRegistryFile([VALID_ENTRY_TESTNET]);
    const result = loadRegistry();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].contractId).toBe(VALID_ENTRY_TESTNET.contractId);
  });

  test('throws when registry.json is not valid JSON', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{ not valid json }');
    expect(() => loadRegistry()).toThrow(/not valid JSON/);
  });

  test('throws when registry.json is not an array', () => {
    mockRegistryFile({ not: 'an array' });
    expect(() => loadRegistry()).toThrow(/must be a JSON array/);
  });

  test('throws when registry.json is an empty array', () => {
    mockRegistryFile([]);
    expect(() => loadRegistry()).toThrow(/at least one entry/i);
  });
});

// ── validateEntry ─────────────────────────────────────────────────────────────

describe('validateEntry()', () => {
  const REQUIRED_FIELDS = ['network', 'contractId', 'wasmHash', 'abiVersion', 'deployedAt', 'active'];

  test('accepts a valid entry without throwing', () => {
    expect(() => validateEntry(VALID_ENTRY_TESTNET, 0)).not.toThrow();
  });

  REQUIRED_FIELDS.forEach((field) => {
    test(`throws when "${field}" is missing`, () => {
      const entry = { ...VALID_ENTRY_TESTNET };
      delete entry[field];
      expect(() => validateEntry(entry, 0)).toThrow(new RegExp(`"${field}"`));
    });
  });

  test('throws when network is not a valid value', () => {
    const entry = { ...VALID_ENTRY_TESTNET, network: 'localnet' };
    expect(() => validateEntry(entry, 0)).toThrow(/network/);
  });

  test('throws when wasmHash is not 64 hex chars', () => {
    const entry = { ...VALID_ENTRY_TESTNET, wasmHash: 'tooshort' };
    expect(() => validateEntry(entry, 0)).toThrow(/wasmHash/);
  });

  test('throws when abiVersion is not semver', () => {
    const entry = { ...VALID_ENTRY_TESTNET, abiVersion: 'v1' };
    expect(() => validateEntry(entry, 0)).toThrow(/abiVersion/);
  });

  test('throws when deployedAt is not an ISO date string', () => {
    const entry = { ...VALID_ENTRY_TESTNET, deployedAt: 'yesterday' };
    expect(() => validateEntry(entry, 0)).toThrow(/deployedAt/);
  });

  test('throws when active is not a boolean', () => {
    const entry = { ...VALID_ENTRY_TESTNET, active: 'yes' };
    expect(() => validateEntry(entry, 0)).toThrow(/active/);
  });

  test('includes the entry index in the error message', () => {
    const entry = { ...VALID_ENTRY_TESTNET };
    delete entry.network;
    expect(() => validateEntry(entry, 3)).toThrow(/\[3\]/);
  });
});

// ── resolveContract ───────────────────────────────────────────────────────────

describe('resolveContract()', () => {
  test('returns the active entry for the requested network', () => {
    const registry = [VALID_ENTRY_TESTNET, VALID_ENTRY_MAINNET];
    const result = resolveContract(registry, 'mainnet');
    expect(result.contractId).toBe(VALID_ENTRY_MAINNET.contractId);
  });

  test('returns null when no active entry exists for the network', () => {
    const registry = [{ ...VALID_ENTRY_TESTNET, active: false }];
    expect(resolveContract(registry, 'testnet')).toBeNull();
  });

  test('returns null for an unknown network', () => {
    const registry = [VALID_ENTRY_TESTNET];
    expect(resolveContract(registry, 'futurenet')).toBeNull();
  });

  test('returns the most recent active entry when multiple exist for the same network', () => {
    const older = { ...VALID_ENTRY_TESTNET, deployedAt: '2024-01-01T00:00:00.000Z' };
    const newer = { ...VALID_ENTRY_TESTNET_V2 };
    const registry = [older, newer];
    const result = resolveContract(registry, 'testnet');
    expect(result.abiVersion).toBe('2.0.0');
    expect(result.contractId).toBe(VALID_ENTRY_TESTNET_V2.contractId);
  });

  test('ignores inactive entries when selecting the latest', () => {
    const inactive = { ...VALID_ENTRY_TESTNET_V2, active: false };
    const active   = { ...VALID_ENTRY_TESTNET };
    const registry = [inactive, active];
    const result = resolveContract(registry, 'testnet');
    expect(result.abiVersion).toBe('1.0.0');
  });

  test('returns null for a null or undefined registry', () => {
    expect(resolveContract(null, 'testnet')).toBeNull();
    expect(resolveContract(undefined, 'testnet')).toBeNull();
  });
});

// ── validateRegistryOnStartup ─────────────────────────────────────────────────

describe('validateRegistryOnStartup()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null and does not throw when the registry file is absent', () => {
    mockMissingFile();
    expect(() => validateRegistryOnStartup()).not.toThrow();
    expect(validateRegistryOnStartup()).toBeNull();
  });

  test('returns the parsed registry for a valid file', () => {
    mockRegistryFile([VALID_ENTRY_TESTNET]);
    const result = validateRegistryOnStartup();
    expect(Array.isArray(result)).toBe(true);
  });

  test('throws with a startup-prefixed message on an invalid registry', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([{ network: 'testnet' }]));
    expect(() => validateRegistryOnStartup()).toThrow(/ContractRegistry startup validation failed/);
  });

  test('startup error message includes the original validation detail', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([{ ...VALID_ENTRY_TESTNET, wasmHash: 'bad' }]));
    expect(() => validateRegistryOnStartup()).toThrow(/wasmHash/);
  });
});

// ── getActiveContract ─────────────────────────────────────────────────────────

describe('getActiveContract()', () => {
  const originalEnv = process.env.STELLAR_NETWORK;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.STELLAR_NETWORK;
    else process.env.STELLAR_NETWORK = originalEnv;
    jest.clearAllMocks();
  });

  test('resolves the correct contract for STELLAR_NETWORK=testnet', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    mockRegistryFile([VALID_ENTRY_TESTNET, VALID_ENTRY_MAINNET]);
    const contract = getActiveContract();
    expect(contract.network).toBe('testnet');
    expect(contract.contractId).toBe(VALID_ENTRY_TESTNET.contractId);
  });

  test('resolves the correct contract for STELLAR_NETWORK=mainnet', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    mockRegistryFile([VALID_ENTRY_TESTNET, VALID_ENTRY_MAINNET]);
    const contract = getActiveContract();
    expect(contract.network).toBe('mainnet');
    expect(contract.contractId).toBe(VALID_ENTRY_MAINNET.contractId);
  });

  test('defaults to testnet when STELLAR_NETWORK is not set', () => {
    delete process.env.STELLAR_NETWORK;
    mockRegistryFile([VALID_ENTRY_TESTNET]);
    const contract = getActiveContract();
    expect(contract.network).toBe('testnet');
  });

  test('returns null when registry file is absent', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    mockMissingFile();
    expect(getActiveContract()).toBeNull();
  });
});
