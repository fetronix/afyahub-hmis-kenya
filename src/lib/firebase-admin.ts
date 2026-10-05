import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

if (!getApps().length) {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      initializeApp({
        projectId: config.projectId,
      });
    } else {
      initializeApp();
    }
  } catch (err) {
    initializeApp();
  }
}

export const adminAuth = getAuth();
