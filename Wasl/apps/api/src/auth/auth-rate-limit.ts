import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';

const WINDOW_MS = 60_000;
const MAX_KEYS = 4096;
const policies = {
  login: { source: 30, subject: 8 },
  refresh: { source: 120, subject: 0 },
  logout: { source: 120, subject: 0 },
  'switch-school': { source: 120, subject: 24 },
};
type Operation = keyof typeof policies;
type Window = { end: number; counts: Map<string, number> };

function sourceOf(ip: string) {
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6 || ip.includes('%')) return 'unknown';
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) {
    const [high, low] = canonical.slice(7).split(':').map(group => Number.parseInt(group, 16));
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  // Group IPv6 privacy addresses by their network prefix.
  const [leading, trailing] = canonical.split('::');
  const head = leading ? leading.split(':') : [];
  if (trailing !== undefined) {
    const tail = trailing ? trailing.split(':') : [];
    head.push(...Array<string>(8 - head.length - tail.length).fill('0'), ...tail);
  }
  return head.slice(0, 4).join(':');
}

@Injectable()
export class AuthRateLimit {
  private readonly windows = new Map<Operation, Window>();
  private readonly key = randomBytes(32);
  private loginInFlight = 0;

  check(operation: Operation, request: Request, response: Response, subject?: string) {
    const seconds = this.consume(operation, request.ip ?? '', subject);
    if (seconds) this.reject(response, seconds);
  }

  async login<T>(response: Response, work: () => Promise<T>) {
    if (this.loginInFlight >= 8) this.reject(response, 1);
    this.loginInFlight++;
    try { return await work(); }
    finally { this.loginInFlight--; }
  }

  consume(operation: Operation, ip: string, subject?: string, now = performance.now()) {
    let window = this.windows.get(operation);
    if (!window || now >= window.end) {
      window = { end: now + WINDOW_MS, counts: new Map() };
      this.windows.set(operation, window);
    }
    const source = sourceOf(ip);
    const policy = policies[operation];
    const buckets: [string, number][] = [[`ip:${source}`, policy.source]];
    if (subject !== undefined && policy.subject) {
      const identity = createHmac('sha256', this.key).update(subject).digest('hex');
      buckets.push([operation === 'login' ? `login:${source}:${identity}` : `user:${identity}`, policy.subject]);
    }
    const { counts } = window;
    const missing = buckets.filter(([key]) => !counts.has(key)).length;
    if (counts.size + missing > MAX_KEYS || buckets.some(([key, limit]) => (counts.get(key) ?? 0) >= limit))
      return Math.ceil((window.end - now) / 1000);
    for (const [key] of buckets) counts.set(key, (counts.get(key) ?? 0) + 1);
    return 0;
  }

  private reject(response: Response, seconds: number): never {
    response.set('Retry-After', String(seconds)).set('Cache-Control', 'no-store');
    throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
