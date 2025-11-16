// /api/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

// Role definitions
export type UserRole = 'agent' | 'lead' | 'admin';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
    }
  }
}

// API Key to Role mapping (in production, use JWT or database lookup)
const API_KEY_ROLES: Record<string, { userId: string; email: string; role: UserRole }> = {
  'sentinel-dev-key': { userId: 'agent_001', email: 'agent@sentinel.com', role: 'agent' },
  'sentinel-lead-key': { userId: 'lead_001', email: 'lead@sentinel.com', role: 'lead' },
  'sentinel-admin-key': { userId: 'admin_001', email: 'admin@sentinel.com', role: 'admin' },
};

/**
 * API Key Authentication Middleware
 * Validates API key and attaches user role to request
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Missing API Key' });
  }

  const userInfo = API_KEY_ROLES[apiKey];
  if (!userInfo) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  // Attach user info to request
  req.user = {
    id: userInfo.userId,
    email: userInfo.email,
    role: userInfo.role,
  };

  next();
};

/**
 * Role-Based Access Control Middleware
 * Restricts access to specific roles
 */
export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
};

/**
 * Permission checks for specific actions
 */
export const canForceApprove = (role: UserRole): boolean => {
  return role === 'lead' || role === 'admin';
};

export const canAccessAuditLogs = (role: UserRole): boolean => {
  return role === 'lead' || role === 'admin';
};

export const canModifyPolicies = (role: UserRole): boolean => {
  return role === 'admin';
};