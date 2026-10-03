import { env } from '../config/env.js';
import * as local from './local.js';
import * as db from './db.js';

// Chosen once at startup by STORAGE_DRIVER ('local' folder on disk, or 'db' inside PostgreSQL)
const driver = env.STORAGE_DRIVER === 'db' ? db : local;
export const put = (...a) => driver.put(...a);
export const get = (...a) => driver.get(...a);
export const remove = (...a) => driver.remove(...a);
