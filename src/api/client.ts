import type { Config } from '../config.js';
import { object, array } from './models.js';
export class CloudError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export class AuthError extends CloudError {}
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export class NexiaClient {
  houseId?: string;
  readonly origin: string;
  private apiKey?: string;
  private mobileId?: string;
  private loginPending?: Promise<void>;
  private authBlocked = false;
  private cookies = new Map<string, string>();
  private abort = new AbortController();
  constructor(
    private config: Config,
    private uuid: string,
    private transport: Transport = fetch,
  ) {
    this.origin = {
      trane: 'https://www.tranehome.com',
      nexia: 'https://www.mynexia.com',
      asair: 'https://asairhome.com',
    }[config.brand];
    this.houseId = config.houseId;
  }
  private resolve(path: string): string {
    const url = new URL(path, this.origin);
    const brands = ['https://www.tranehome.com', 'https://www.mynexia.com', 'https://asairhome.com'];
    if (!brands.includes(url.origin) || url.username || url.password)
      throw new CloudError('Cloud action has an untrusted origin');
    // Nexia payloads often carry the legacy brand hostname, even for Trane accounts.
    return new URL(url.pathname + url.search, this.origin).href;
  }
  private async send(
    path: string,
    method: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.resolve(path);
    if (this.abort.signal.aborted) throw new CloudError('Plugin is shutting down');
    const headers: Record<string, string> = {
      'X-AppVersion': '6.0.0',
      'X-AssociatedBrand': this.config.brand,
      Accept: 'application/json',
      ...extra,
    };
    if (this.apiKey) headers['X-ApiKey'] = this.apiKey;
    if (this.mobileId) headers['X-MobileId'] = this.mobileId;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.transport(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]),
      });
    } catch {
      throw new CloudError('Trane network request failed or timed out');
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  private check(response: Response): void {
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status))
      throw new AuthError('Trane session expired or authentication was rejected', response.status);
    if (!response.ok && response.status !== 304) {
      const retry = response.headers.get('retry-after');
      const seconds = retry
        ? Number.isFinite(Number(retry))
          ? Number(retry)
          : Math.max(0, (Date.parse(retry) - Date.now()) / 1000)
        : undefined;
      throw new CloudError(
        `Trane cloud returned HTTP ${response.status}`,
        response.status,
        Number.isFinite(seconds) ? seconds : undefined,
      );
    }
  }
  private async decode(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new CloudError('Trane returned an invalid JSON response');
    }
  }
  async login(): Promise<void> {
    if (this.authBlocked)
      throw new AuthError('Authentication stopped; check Trane credentials and restart the child bridge');
    if (!this.loginPending) {
      this.loginPending = this.signIn().finally(() => {
        this.loginPending = undefined;
      });
    }
    return this.loginPending;
  }
  private async signIn(): Promise<void> {
    this.apiKey = undefined;
    this.mobileId = undefined;
    this.cookies.clear();
    try {
      const response = await this.send('/mobile/accounts/sign_in', 'POST', {
        login: this.config.username,
        password: this.config.password,
        device_uuid: this.uuid,
        device_name: 'Homebridge Trane Home',
        app_version: '6.0.0',
        children: [],
        childSchemas: [],
        commitModel: null,
        nextHref: null,
        is_commercial: false,
      });
      this.check(response);
      const data = object(await this.decode(response));
      const result = object(data.result);
      if (data.success !== true || !result.api_key || !result.mobile_id)
        throw new AuthError('Trane login rejected; check credentials or sign in through the Trane app');
      this.apiKey = String(result.api_key);
      this.mobileId = String(result.mobile_id);
      if (!this.houseId) {
        const session = await this.send('/mobile/session', 'POST', {
          app_version: '6.0.0',
          device_uuid: this.uuid,
        });
        this.check(session);
        const houses = array(object(object(object(await this.decode(session)).result)._links).child).filter(
          (l) => /\/mobile\/houses\/[^/]+$/.test(String(l.href)),
        );
        if (houses.length !== 1)
          throw new CloudError('Account has zero or multiple houses; configure houseId explicitly');
        this.houseId = String(object(houses[0]?.data).id);
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(this.houseId)) throw new CloudError('Invalid houseId returned by cloud');
    } catch (error) {
      if (error instanceof AuthError) this.authBlocked = true;
      this.apiKey = undefined;
      this.mobileId = undefined;
      throw error;
    }
  }
  private async authenticated(
    path: string,
    method: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<Response> {
    if (!this.apiKey) await this.login();
    let response = await this.send(path, method, body, extra);
    if (method === 'GET' && [302, 401, 403].includes(response.status)) {
      await response.body?.cancel();
      await this.login();
      response = await this.send(path, method, body, extra);
    }
    this.check(response);
    return response;
  }
  async house(etag?: string): Promise<{ data?: unknown; etag?: string }> {
    if (!this.apiKey) await this.login();
    const response = await this.authenticated(
      `/mobile/houses/${this.houseId}`,
      'GET',
      undefined,
      etag ? { 'If-None-Match': etag } : {},
    );
    if (response.status === 304) return {};
    return { data: await this.decode(response), etag: response.headers.get('etag') ?? undefined };
  }
  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    // Validate before login so an untrusted action cannot cause authentication side effects.
    this.resolve(path);
    if (!['GET', 'POST', 'PUT'].includes(method)) throw new CloudError('Unsupported cloud action method');
    const response = await this.authenticated(path, method, body);
    if (response.status === 204) return {};
    return this.decode(response);
  }
  close(): void {
    this.abort.abort();
    this.cookies.clear();
    this.apiKey = undefined;
  }
}
