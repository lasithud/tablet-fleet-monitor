'use strict';

const crypto = require('crypto');

/**
 * Shared-token auth for the hosted deployment.
 *
 * A single secret (the FLEET_TOKEN env var) gates both the dashboard API and the
 * FleetAgent endpoints. When FLEET_TOKEN is unset — e.g. local development — auth
 * is disabled entirely so `npm run backend` keeps working with no friction.
 *
 * Callers present the token one of three ways (checked in this order):
 *   - `Authorization: Bearer <token>`   (dashboard fetch)
 *   - `X-Fleet-Token: <token>`          (FleetAgent APK)
 *   - `?token=<token>`                   (WebSocket upgrade — browsers can't set
 *                                         headers on a WebSocket handshake)
 */

const TOKEN = (process.env.FLEET_TOKEN || '').trim();
const authEnabled = TOKEN.length > 0;

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Pull a presented token out of an Express request. */
function extractToken(req) {
  const header = req.headers['authorization'];
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  if (req.headers['x-fleet-token']) return String(req.headers['x-fleet-token']).trim();
  if (req.query && req.query.token) return String(req.query.token).trim();
  return '';
}

/** Express middleware: 401 unless a valid token is presented (no-op if disabled). */
function requireAuth(req, res, next) {
  if (!authEnabled) return next();
  if (safeEqual(extractToken(req), TOKEN)) return next();
  res.set('WWW-Authenticate', 'Bearer');
  return res.status(401).json({ error: 'Unauthorized' });
}

/** Validate the token on a raw WebSocket upgrade request (token is in the URL). */
function wsTokenValid(req) {
  if (!authEnabled) return true;
  let token = '';
  try {
    token = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
  } catch (_) {
    token = '';
  }
  return safeEqual(token, TOKEN);
}

module.exports = { authEnabled, requireAuth, wsTokenValid };
