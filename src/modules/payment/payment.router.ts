import { Router } from 'express';
import express from 'express';
import paymentController from './payment.controller';
import { isAdmin, protect } from '../../middlewares/auth.middleware';

const router = Router();

router.post('/create-payment', protect, paymentController.createPayment);

router.get('/my-payments', protect, paymentController.getMyPayments);

// admin only (add authorize middleware)
router.get('/all-payments', protect, isAdmin, paymentController.getAllPayments);
router.patch('/status/:id', protect, isAdmin, paymentController.updatePaymentStatus);
router.delete('/:id', protect, isAdmin, paymentController.deletePayment);

// myPOS callbacks are form encoded. They must remain public and unprotected.
router.post('/webhook', express.urlencoded({ extended: false }), paymentController.myPosWebhook);
router.get('/return/success', paymentController.myPosSuccessReturn);
router.post('/return/success', express.urlencoded({ extended: false }), paymentController.myPosSuccessReturn);
router.get('/return/cancel', paymentController.myPosCancelReturn);
router.post('/return/cancel', express.urlencoded({ extended: false }), paymentController.myPosCancelReturn);

export default router;
