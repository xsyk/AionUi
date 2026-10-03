/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildFeishuConfigPayload } from '@/renderer/pages/admin/adminApi';

const form = {
  enabled: true,
  app_id: ' cli_a ',
  app_secret: '',
  public_base_url: 'https://aidi.example.com',
  api_base: '',
  accounts_base: ' ',
};

describe('buildFeishuConfigPayload', () => {
  it('omits a blank secret so the stored one is kept', () => {
    const payload = buildFeishuConfigPayload(form, false);
    expect(payload).not.toHaveProperty('app_secret');
    expect(payload).toMatchObject({
      enabled: true,
      app_id: 'cli_a',
      api_base: null,
      accounts_base: null,
      clear_tenant_key: false,
    });
  });

  it('sends a new secret and the clear-tenant flag', () => {
    const payload = buildFeishuConfigPayload({ ...form, app_secret: ' s3 ', api_base: 'http://mock:9' }, true);
    expect(payload).toMatchObject({ app_secret: 's3', api_base: 'http://mock:9', clear_tenant_key: true });
  });
});
