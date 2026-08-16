import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'en18031-test-'));
process.env.STORAGE_LOCAL_DIR = path.join(tmp, 'files');
process.env.DB_PATH = path.join(tmp, 'sqlite', 'test.db');
process.env.LOG_LEVEL = 'silent';

export const testDir = tmp;
