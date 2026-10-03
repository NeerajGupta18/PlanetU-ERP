import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as raw from '../controllers/superadmin.controller.js';
import * as rawBilling from '../controllers/billing.controller.js';
import { uuidParam, wrapAll } from './wrap.js';

const sa = wrapAll(raw);
const bill = wrapAll(rawBilling);
const router = Router();
router.use(requireAuth, requireRole('super_admin'));
router.param('id', uuidParam);
router.param('invoiceId', uuidParam);
router.param('orderId', uuidParam);

router.get('/presets', sa.presets);
router.get('/dashboard', sa.dashboard);
router.get('/tenants', sa.listTenants);
router.post('/tenants', sa.createTenant);
router.get('/tenants/:id', sa.getTenant);
router.put('/tenants/:id', sa.updateTenant);
router.post('/tenants/:id/reset-admin-password', sa.resetAdminPassword);

router.get('/diagnostics/network', sa.networkDiagnostics);

// ---- billing: PlanetU charging its institutes ----
router.get('/billing/overview', bill.overview);
router.get('/billing/plans', bill.plans);
router.put('/billing/plans/:key', bill.updatePlan);
router.get('/billing/subscriptions', bill.subscriptions);
router.get('/billing/tenants/:id', bill.tenantBilling);
router.put('/billing/tenants/:id/subscription', bill.updateSubscription);
router.put('/billing/tenants/:id/profile', bill.saveProfile);
router.post('/billing/tenants/:id/invoices', bill.generate);
router.post('/billing/tenants/:id/choose-plan', bill.choosePlanFor);
router.get('/billing/invoices', bill.invoices);
router.get('/billing/invoices/:invoiceId', bill.invoice);
router.get('/billing/invoices/:invoiceId/pdf', bill.invoicePdf);
router.post('/billing/invoices/:invoiceId/void', bill.voidInvoice);
router.post('/billing/invoices/:invoiceId/payments', bill.recordPayment);
router.post('/billing/invoices/:invoiceId/remind', bill.remind);
router.post('/billing/run', bill.runNow);
router.get('/billing/review-orders', bill.reviewOrders);
router.post('/billing/review-orders/:orderId/resolve', bill.resolveOrder);

export default router;
