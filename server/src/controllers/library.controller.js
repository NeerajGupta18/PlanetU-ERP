import * as svc from '../services/library.service.js';

export const listBooks = async (req, res) => res.json({ books: await svc.listBooks({ search: req.query.search, category: req.query.category }) });
export const getBook = async (req, res) => res.json({ book: await svc.getBook(req.params.id) });
export const createBook = async (req, res) => res.status(201).json({ book: await svc.createBook(req.body) });
export const updateBook = async (req, res) => res.json({ book: await svc.updateBook(req.params.id, req.body) });
export const deleteBook = async (req, res) => { await svc.deleteBook(req.params.id); res.json({ success: true }); };

export const listIssues = async (req, res) => res.json({ issues: await svc.listIssues({ status: req.query.status }) });
export const issueBook = async (req, res) => res.status(201).json({ issue: await svc.issueBook(req.body, req.user) });
export const returnBook = async (req, res) => res.json({ issue: await svc.returnBook(req.params.id, req.user) });
export const payFine = async (req, res) => res.json({ issue: await svc.payFine(req.params.id, req.user) });

/** Student portal: search the catalogue and see their own loans. */
export const catalogue = async (req, res) => res.json({ books: await svc.listBooks({ search: req.query.search, category: req.query.category }) });
export const myIssues = async (req, res) => res.json({ issues: await svc.myIssues(req.user.studentId) });
