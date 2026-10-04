import * as svc from '../services/courses.service.js';

export const list = async (req, res) => res.json({ courses: await svc.listCourses() });
export const create = async (req, res) => res.status(201).json({ course: await svc.createCourse(req.user, req.body) });
export const update = async (req, res) => res.json({ course: await svc.updateCourse(req.user, req.params.id, req.body) });
export const remove = async (req, res) => { await svc.removeCourse(req.user, req.params.id); res.json({ success: true }); };
