/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const REMEMBER_ME_KEY = 'rememberMe';
const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';

export type RememberedCredentials = { username: string; password: string };

// Simple obfuscation for stored credentials (not cryptographically secure, but prevents plain text storage)
const obfuscate = (text: string): string => btoa(encodeURIComponent(text)).split('').toReversed().join('');

const deobfuscate = (text: string): string => {
  try {
    return decodeURIComponent(atob(text.split('').toReversed().join('')));
  } catch {
    return '';
  }
};

/** Credentials saved by an earlier "Remember me" sign-in, or null. */
export function readRememberedCredentials(): RememberedCredentials | null {
  if (localStorage.getItem(REMEMBER_ME_KEY) !== 'true') return null;
  return {
    username: deobfuscate(localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? ''),
    password: deobfuscate(localStorage.getItem(REMEMBERED_PASSWORD_KEY) ?? ''),
  };
}

export function rememberCredentials({ username, password }: RememberedCredentials): void {
  localStorage.setItem(REMEMBER_ME_KEY, 'true');
  localStorage.setItem(REMEMBERED_USERNAME_KEY, obfuscate(username));
  localStorage.setItem(REMEMBERED_PASSWORD_KEY, obfuscate(password));
}

export function forgetCredentials(): void {
  localStorage.removeItem(REMEMBER_ME_KEY);
  localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
}
