import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import dashboardController from './dashboard.controller';

const router = Router();

router.get('/stats', protect, dashboardController.getDashboardStats);

export default router;
