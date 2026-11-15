import express, { Router, type Response, type Request, type NextFunction } from 'express';
import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePortalAuth, type PortalRequest } from '../portal/portal.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { documentLimit, PatientDocumentError } from './patient-file-validation.ts';
import * as svc from './patient-documents.service.ts';

const staff = Router();
const portal = Router();
staff.use(requireAuth);
portal.use(requirePortalAuth);
function failure(e: unknown, res: Response) {
  if (e instanceof PatientDocumentError)
    return res.status(e.status).json({ error: e.code, message: e.message });
  return res.status(500).json({
    error: 'DOCUMENT_OPERATION_FAILED',
    message: 'Document operation failed; no document content is logged.',
  });
}
function sendFile(res: Response, d: Record<string, any>, download: boolean) {
  res.set({
    'Content-Type': d.mime_type,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  return res.send(d.original_bytes);
}
staff.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
staff.post(
  '/patients/:patientId',
  requirePermission('patients.documents.upload'),
  express.raw({ type: () => true, limit: documentLimit() }),
  async (req: AuthRequest, res) => {
    try {
      const metadata = JSON.parse(decodeURIComponent(String(req.get('X-Document-Metadata') ?? '')));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        throw new PatientDocumentError('INVALID_METADATA', 'Document metadata is required.');
      if (!Buffer.isBuffer(req.body))
        throw new PatientDocumentError('EMPTY_DOCUMENT', 'File bytes are required.');
      return res
        .status(201)
        .json(
          await svc.uploadPatientDocument(
            req.authContext!,
            svc.idOf(req.params.patientId),
            metadata,
            req.body,
            (req.get('Content-Type') ?? '').split(';')[0],
          ),
        );
    } catch (e) {
      if (e instanceof URIError || e instanceof SyntaxError)
        return res.status(400).json({ error: 'INVALID_METADATA' });
      return failure(e, res);
    }
  },
);
staff.get('/patients/:patientId/doctors', async (req: AuthRequest, res) => {
  try {
    return res.json(
      await svc.responsibleDoctorOptions(
        req.authContext!,
        svc.idOf(req.params.patientId),
        req.query.search,
      ),
    );
  } catch (e) {
    return failure(e, res);
  }
});
staff.get('/patients/:patientId', async (req: AuthRequest, res) => {
  try {
    return res.json(
      await svc.listPatientDocuments(req.authContext!, svc.idOf(req.params.patientId), req.query),
    );
  } catch (e) {
    return failure(e, res);
  }
});
staff.get('/patients/:patientId/:id/file', async (req: AuthRequest, res) => {
  try {
    return sendFile(
      res,
      await svc.readPatientDocument(
        req.authContext!,
        svc.idOf(req.params.patientId),
        svc.idOf(req.params.id),
        req.query.download === '1',
      ),
      req.query.download === '1',
    );
  } catch (e) {
    return failure(e, res);
  }
});
staff.get('/patients/:patientId/:id/history', async (req: AuthRequest, res) => {
  try {
    return res.json(
      await svc.documentHistory(
        req.authContext!,
        svc.idOf(req.params.patientId),
        svc.idOf(req.params.id),
      ),
    );
  } catch (e) {
    return failure(e, res);
  }
});
staff.post(
  '/patients/:patientId/:id/release',
  express.json({ limit: '8kb' }),
  async (req: AuthRequest, res) => {
    try {
      return res.json(
        await svc.releasePatientDocument(
          req.authContext!,
          svc.idOf(req.params.patientId),
          svc.idOf(req.params.id),
          req.body?.released,
          req.body?.reason,
        ),
      );
    } catch (e) {
      return failure(e, res);
    }
  },
);
staff.get('/radiology/:id/consent', async (req: AuthRequest, res) => {
  try {
    return res.json(await svc.radiologyConsent(req.authContext!, svc.idOf(req.params.id)));
  } catch (e) {
    return failure(e, res);
  }
});
staff.post(
  '/radiology/:id/consent',
  express.json({ limit: '8kb' }),
  async (req: AuthRequest, res) => {
    try {
      return res.json(
        await svc.decideRadiologyConsent(req.authContext!, svc.idOf(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return failure(e, res);
    }
  },
);
staff.post('/radiology-policy', express.json({ limit: '8kb' }), async (req: AuthRequest, res) => {
  try {
    return res.json(await svc.setRadiologyConsentPolicy(req.authContext!, req.body ?? {}));
  } catch (e) {
    return failure(e, res);
  }
});
staff.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (typeof e === 'object' && e && 'type' in e && e.type === 'entity.too.large') {
    res.status(413).json({
      error: 'DOCUMENT_TOO_LARGE',
      message: 'Document exceeds the configured upload size limit.',
    });
    return;
  }
  if (e instanceof SyntaxError) {
    res.status(400).json({ error: 'INVALID_JSON' });
    return;
  }
  failure(e, res);
});
portal.get('/', async (req: PortalRequest, res) => {
  try {
    return res
      .set('Cache-Control', 'private, no-store')
      .json(await svc.portalPatientDocuments(req.portalSession!));
  } catch (e) {
    return failure(e, res);
  }
});
portal.get('/:id/file', async (req: PortalRequest, res) => {
  try {
    // Preview also transfers original bytes: obey download policy, not just the attachment flag.
    return sendFile(
      res,
      await svc.portalPatientDocuments(req.portalSession!, svc.idOf(req.params.id), true),
      req.query.download === '1',
    );
  } catch (e) {
    return failure(e, res);
  }
});
export { staff as patientDocumentsRoutes, portal as portalDocumentsRoutes };
