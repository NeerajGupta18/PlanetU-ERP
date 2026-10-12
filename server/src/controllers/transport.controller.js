import * as svc from '../services/transport.service.js';

/* ---------- student (and parent) ---------- */
export const mine = async (req, res) => res.json(await svc.myRide(req.user.studentId));

/* ---------- office ---------- */
export const routes = async (req, res) => res.json({ routes: await svc.listRoutes() });
export const createRoute = async (req, res) => res.status(201).json({ route: await svc.createRoute(req.body || {}, req.user) });
export const updateRoute = async (req, res) => res.json({ route: await svc.updateRoute(req.params.id, req.body || {}, req.user) });
export const removeRoute = async (req, res) => { await svc.removeRoute(req.params.id, req.user); res.json({ success: true }); };
export const rides = async (req, res) => res.json({ rides: await svc.listRides({ routeId: req.query.routeId, status: req.query.status, search: req.query.search }) });
export const assign = async (req, res) => res.status(201).json({ ride: await svc.assign(req.body || {}, req.user) });
export const endRide = async (req, res) => res.json({ ride: await svc.endRide(req.params.id, req.body || {}, req.user) });
export const change = async (req, res) => res.json({ ride: await svc.change(req.params.id, req.body || {}, req.user) });
