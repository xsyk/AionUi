/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getClientBusinessSettingMock, mcpServiceMock } = vi.hoisted(() => ({
  getClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
}));

import { ensureBackendMcpCatalog, isBuiltinImageGenServer } from '@/renderer/hooks/mcp/catalog';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });
});

describe('isBuiltinImageGenServer', () => {
  it('recognises the built-in row by its stable id', () => {
    expect(isBuiltinImageGenServer({ id: BUILTIN_IMAGE_GEN_ID, name: 'whatever', builtin: true })).toBe(true);
  });

  it('recognises the built-in row by its name', () => {
    expect(isBuiltinImageGenServer({ id: 'row-1', name: BUILTIN_IMAGE_GEN_NAME, builtin: true })).toBe(true);
  });

  it('leaves other built-in rows alone', () => {
    expect(isBuiltinImageGenServer({ id: 'builtin-browser', name: 'aionui-browser', builtin: true })).toBe(false);
  });

  it('leaves a server the user made themselves alone, even with the same name', () => {
    expect(isBuiltinImageGenServer({ id: 'row-1', name: BUILTIN_IMAGE_GEN_NAME, builtin: false })).toBe(false);
    expect(isBuiltinImageGenServer({ id: BUILTIN_IMAGE_GEN_ID, name: 'x' })).toBe(false);
  });
});
