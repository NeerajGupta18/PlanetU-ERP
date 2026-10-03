import { Router } from 'express';
import multer from 'multer';
import { rebindTx, requireAuth } from '../middleware/auth.js';
import * as raw from '../controllers/files.controller.js';
import { MAX_BYTES } from '../services/files.service.js';
import { uuidParam, wrapAll } from './wrap.js';

const files = wrapAll(raw);
const router = Router();
// Memory storage + a hard size cap; bytes are validated (magic numbers) before anything touches disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

router.use(requireAuth); // authenticate BEFORE parsing the upload body
router.param('id', uuidParam);
router.post('/', upload.single('file'), rebindTx, files.upload);
router.get('/:id', files.download);
router.delete('/:id', files.remove);

export default router;
