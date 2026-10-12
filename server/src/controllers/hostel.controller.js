import * as svc from '../services/hostel.service.js';

/* ---------- student (and parent) ---------- */
export const mine = async (req, res) => res.json(await svc.myStay(req.user.studentId));

/* ---------- office ---------- */
export const hostels = async (req, res) => res.json({ hostels: await svc.listHostels() });
export const createHostel = async (req, res) => res.status(201).json({ hostel: await svc.createHostel(req.body || {}, req.user) });
export const updateHostel = async (req, res) => res.json({ hostel: await svc.updateHostel(req.params.id, req.body || {}, req.user) });
export const removeHostel = async (req, res) => { await svc.removeHostel(req.params.id, req.user); res.json({ success: true }); };
export const rooms = async (req, res) => res.json({ rooms: await svc.listRooms(req.params.id) });
export const createRooms = async (req, res) => res.status(201).json(await svc.createRooms(req.params.id, req.body || {}, req.user));
export const updateRoom = async (req, res) => res.json({ room: await svc.updateRoom(req.params.id, req.body || {}, req.user) });
export const removeRoom = async (req, res) => { await svc.removeRoom(req.params.id, req.user); res.json({ success: true }); };
export const stays = async (req, res) => res.json({ stays: await svc.listStays({ hostelId: req.query.hostelId, status: req.query.status, search: req.query.search }) });
export const allot = async (req, res) => res.status(201).json({ stay: await svc.allot(req.body || {}, req.user) });
export const vacate = async (req, res) => res.json({ stay: await svc.vacate(req.params.id, req.body || {}, req.user) });
export const transfer = async (req, res) => res.json({ stay: await svc.transfer(req.params.id, req.body || {}, req.user) });
