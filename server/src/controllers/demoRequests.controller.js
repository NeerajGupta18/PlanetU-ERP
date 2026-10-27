import * as svc from '../services/demoRequests.service.js';
import * as chat from '../../agents/supportChat.js';

export const list = async (req, res) => res.json(await svc.listDemoRequests());
export const setStatus = async (req, res) => res.json(await svc.setDemoRequestStatus(req.params.id, req.body?.status));

// Messages left for the team in the help chat on the public page
export const listMessages = async (req, res) => res.json(await chat.listSupportMessages());
export const setMessageStatus = async (req, res) => res.json(await chat.setSupportMessageStatus(req.params.id, req.body?.status));
