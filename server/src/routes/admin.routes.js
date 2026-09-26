import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/dashboard', admin.dashboard);

router.get('/institute', admin.getInstitute);
router.put('/institute', admin.updateInstituteDetails);
router.post('/institute/authorized-persons', admin.addAuthorizedPerson);
router.put('/institute/authorized-persons/:index', admin.updateAuthorizedPerson);
router.delete('/institute/authorized-persons/:index', admin.removeAuthorizedPerson);
router.post('/institute/stakeholders', admin.addStakeholder);
router.put('/institute/stakeholders/:index', admin.updateStakeholder);
router.delete('/institute/stakeholders/:index', admin.removeStakeholder);
router.post('/institute/documents', admin.addDocument);
router.put('/institute/documents/:index', admin.updateDocument);
router.delete('/institute/documents/:index', admin.removeDocument);
router.post('/institute/beneficiaries', admin.addBeneficiary);
router.put('/institute/beneficiaries/:index', admin.updateBeneficiary);
router.delete('/institute/beneficiaries/:index', admin.removeBeneficiary);
router.put('/institute/stamp', admin.updateStamp);

router.get('/departments', admin.listDepartments);
router.post('/departments', admin.createDepartment);
router.put('/departments/:id', admin.updateDepartment);
router.delete('/departments/:id', admin.removeDepartment);

router.get('/designations', admin.listDesignations);
router.post('/designations', admin.createDesignation);
router.delete('/designations/:id', admin.removeDesignation);

router.get('/employees', admin.listEmployees);
router.post('/employees', admin.createEmployee);
router.put('/employees/:id', admin.updateEmployee);
router.delete('/employees/:id', admin.removeEmployee);

router.get('/calendar', admin.listEvents);
router.post('/calendar', admin.createEvent);
router.put('/calendar/:id', admin.updateEvent);
router.delete('/calendar/:id', admin.removeEvent);

router.get('/timetable/filters', admin.timetableFilters);
router.get('/timetable', admin.listTimetable);
router.get('/timetable/slots', admin.listSlots);
router.post('/timetable/slots', admin.createSlot);
router.put('/timetable/slots/:id', admin.updateSlot);
router.delete('/timetable/slots/:id', admin.removeSlot);
router.put('/timetable/reassign', admin.reassign);
router.put('/timetable/reassign/undo', admin.undoReassign);

export default router;
