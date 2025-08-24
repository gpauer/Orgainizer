import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';

interface CachedTokenInfo { exp: number; checkedAt: number; }
const tokenInfoCache = new Map<string, CachedTokenInfo>();

export function requireValidTokenFactory(oAuth2Client: OAuth2Client) {
  return async function requireValidToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers['token'] as string | undefined;
      if (!token) return res.status(401).json({ error: 'Missing token header' });
      const cached = tokenInfoCache.get(token);
      const now = Date.now();
      if (cached && now < cached.exp - 30_000) {
        return next();
      }
      const info: any = await oAuth2Client.getTokenInfo(token);
      let exp = now + 5 * 60 * 1000;
      if (typeof info.expires_in === 'number') {
        exp = now + info.expires_in * 1000;
      } else if (info.exp) {
        exp = info.exp * 1000;
      }
      if (exp <= now) return res.status(401).json({ error: 'Token expired' });
      tokenInfoCache.set(token, { exp, checkedAt: now });
      next();
    } catch (err: any) {
      return res.status(401).json({ error: 'Invalid or expired token', detail: err?.message });
    }
  };
}
