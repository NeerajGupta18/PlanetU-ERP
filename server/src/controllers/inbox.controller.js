import * as inbox from '../services/inbox.service.js';
import * as approvals from '../services/approvals.service.js';
import { setupStatus } from '../services/setup.service.js';

const modulesOf = (req) => req.tenant?.modules || [];

/* ---------- any signed-in institute user ---------- */
export const bell = async (req, res) => res.json(await inbox.bell(req.user, modulesOf(req)));
export const read = async (req, res) => { await inbox.markRead(req.user, req.params.id); res.json({ success: true }); };
export const readAll = async (req, res) => { await inbox.markAllRead(req.user); res.json({ success: true }); };

/* ---------- office ---------- */
export const approvalsList = async (req, res) => res.json(await approvals.list(modulesOf(req)));
export const setup = async (req, res) => res.json(await setupStatus(modulesOf(req)));
