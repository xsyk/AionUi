/** Official SDK URL from Feishu's H5 development guide resource.jsSDKUrl. */
export const FEISHU_SDK_URL = 'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.30.js';
const SDK_TIMEOUT_MS = 15000;
type CodeResult = { code?: string };
type CodeCallbacks = {
  success: (result: CodeResult) => void;
  fail: (error: unknown) => void;
};
export type FeishuSdk = {
  requestAccess?: (params: { appID: string; scopeList: string[] } & CodeCallbacks) => void;
  requestAuthCode?: (params: { appId: string } & CodeCallbacks) => void;
};
type FeishuWindow = Window & {
  tt?: FeishuSdk;
  h5sdk?: { ready: (callback: () => void) => void };
  __websocketReconnect?: () => void;
};
let sdkLoading: Promise<FeishuSdk> | null = null;

export function isFeishuClient(userAgent: string, desktop: boolean): boolean {
  return !desktop && /(?:Lark|Feishu)\//i.test(userAgent);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Feishu authorization timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Load only in Feishu; failures clear the shared promise so explicit retry remains possible. */
export function loadFeishuSdk(): Promise<FeishuSdk> {
  if (sdkLoading) return sdkLoading;
  const win = window as FeishuWindow;
  sdkLoading = withTimeout(
    new Promise<FeishuSdk>((resolve, reject) => {
      const ready = () => {
        const accept = () =>
          win.tt?.requestAccess || win.tt?.requestAuthCode
            ? resolve(win.tt)
            : reject(new Error('Feishu SDK unavailable'));
        if (win.h5sdk) win.h5sdk.ready(accept);
        else accept();
      };
      if (win.tt?.requestAccess || win.tt?.requestAuthCode) {
        ready();
        return;
      }
      const script = document.createElement('script');
      script.src = FEISHU_SDK_URL;
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.addEventListener('load', ready, { once: true });
      script.addEventListener(
        'error',
        () => {
          script.remove();
          reject(new Error('Feishu SDK unavailable'));
        },
        { once: true }
      );
      document.head.append(script);
    }),
    SDK_TIMEOUT_MS
  ).catch((error: unknown) => {
    sdkLoading = null;
    throw error;
  });
  return sdkLoading;
}

/** Request login identity only; legacy fallback is limited to the documented unsupported errno. */
export async function requestFeishuCode(sdk: FeishuSdk, appId: string, timeoutMs = SDK_TIMEOUT_MS): Promise<string> {
  let result: CodeResult;
  const legacyCode = () =>
    withTimeout(
      new Promise<CodeResult>((resolve, reject) => {
        if (!sdk.requestAuthCode) throw new Error('Feishu SDK unavailable');
        sdk.requestAuthCode({ appId, success: resolve, fail: reject });
      }),
      timeoutMs
    );
  try {
    result = sdk.requestAccess
      ? await withTimeout(
          new Promise<CodeResult>((resolve, reject) => {
            sdk.requestAccess?.({ appID: appId, scopeList: [], success: resolve, fail: reject });
          }),
          timeoutMs
        )
      : await legacyCode();
  } catch (error) {
    const errno = error && typeof error === 'object' && 'errno' in error ? error.errno : undefined;
    if (!sdk.requestAccess || Number(errno) !== 103 || !sdk.requestAuthCode) throw error;
    result = await legacyCode();
  }
  if (typeof result.code !== 'string' || !result.code.trim()) throw new Error('Feishu returned no authorization code');
  return result.code;
}

/** Code exchange deliberately bypasses authenticated HTTP retries and request-body logging. */
export async function exchangeFeishuCode(code: string, csrfToken: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SDK_TIMEOUT_MS);
  try {
    const response = await fetch('/api/auth/feishu/in-app', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json()) as { success?: boolean; code?: string };
    if (!response.ok || body.success === false) throw new Error(body.code || 'FEISHU_LOGIN_UPSTREAM');
  } finally {
    clearTimeout(timer);
  }
}

export function reconnectAfterFeishuLogin(): void {
  (window as FeishuWindow).__websocketReconnect?.();
}
