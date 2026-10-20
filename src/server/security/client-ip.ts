import type { FastifyRequest } from 'fastify';
import type { DeployMode } from '../config';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(addr: string | undefined): boolean {
  return addr !== undefined && LOOPBACK.has(addr);
}

export function resolveClientIp(req: FastifyRequest, mode: DeployMode): string {
  // Vercel перезаписывает X-Forwarded-For адресом клиента и чужих адресов не передаёт: первый адрес — клиент
  if (mode === 'vercel') {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  if (mode === 'cloudflare' && isLoopback(req.socket.remoteAddress)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim() !== '') return cf.trim();
  }
  return req.ip;
}
