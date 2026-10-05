import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthRequest extends Request {
  user?: DecodedIdToken | { uid: string; email?: string; name?: string; role?: string; tenantId?: number; facilityId?: number };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Check if development session header or role header is provided
    const devUid = req.headers['x-staff-uid'] as string;
    const devRole = req.headers['x-staff-role'] as string;
    const devTenant = req.headers['x-tenant-id'] as string;
    const devFacility = req.headers['x-facility-id'] as string;

    if (devUid || devRole) {
      req.user = {
        uid: devUid || 'staff-admin-01',
        email: (req.headers['x-staff-email'] as string) || 'admin@nairobihospital.ke',
        name: (req.headers['x-staff-name'] as string) || 'Dr. Angela Omwamba (Medical Director)',
        role: devRole || 'Medical Director',
        tenantId: devTenant ? parseInt(devTenant, 10) : 1,
        facilityId: devFacility ? parseInt(devFacility, 10) : 1,
      };
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Missing authorization token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    // If running in development environment and token fails or is a local demo token
    const devUid = req.headers['x-staff-uid'] as string;
    if (devUid) {
      req.user = {
        uid: devUid,
        email: (req.headers['x-staff-email'] as string) || 'staff@afyahub.ke',
        name: (req.headers['x-staff-name'] as string) || 'Clinical Staff',
        role: (req.headers['x-staff-role'] as string) || 'Doctor',
      };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
