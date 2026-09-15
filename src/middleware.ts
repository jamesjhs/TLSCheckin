import type { NextFunction, Request, Response } from 'express';
import { localYymmdd } from './time.js';

export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as typeof req.session & { adminId?: number };
  if (!session.adminId) {
    res.status(401).json({ error: 'Admin login required.' });
    return;
  }
  next();
}

export function requireAdminPage(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as typeof req.session & { adminId?: number };
  if (!session.adminId) {
    res.redirect(`/${localYymmdd()}`);
    return;
  }
  next();
}
