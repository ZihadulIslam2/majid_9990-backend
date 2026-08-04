import { Request, Response } from 'express';
import config from '../../config/config';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import paymentService from './payment.service';
import { StatusCodes } from 'http-status-codes';

// Create session
const createPayment = catchAsync(async (req, res) => {
      const session = await paymentService.createPaymentSession(req.user, req.body);

      sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'myPOS checkout parameters created',
            data: session,
      });
});

// myPOS sends a signed application/x-www-form-urlencoded server-to-server callback.
const myPosWebhook = async (req: Request, res: Response) => {
      try {
            await paymentService.handleMyPosNotification(req.body);
            res.status(StatusCodes.OK).type('text/plain').send('OK');
      } catch (error: any) {
            const statusCode = error?.statusCode || StatusCodes.BAD_REQUEST;
            res.status(statusCode).type('text/plain').send('FAIL');
      }
};

// These are browser return endpoints only. Payment confirmation always comes from myPosWebhook.
const redirectFromMyPos = (destination: 'success' | 'cancel') => (_req: Request, res: Response) => {
      const frontendUrl = config.frontend_url?.replace(/\/+$/, '');

      if (!frontendUrl) {
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).send('FRONTEND_URL is not configured.');
      }

      res.redirect(StatusCodes.SEE_OTHER, `${frontendUrl}/payment/${destination}`);
};

// My payments
const getMyPayments = catchAsync(async (req, res) => {
      const result = await paymentService.getMyPayments(req.user._id);

      sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'My payments fetched',
            data: result,
      });
});

// All payments (admin)
const getAllPayments = catchAsync(async (req, res) => {
      const result = await paymentService.getAllPayments();

      sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'All payments fetched',
            data: result,
      });
});

const updatePaymentStatus = catchAsync(async (req, res) => {
      const result = await paymentService.updatePaymentStatus(req.params.id as string, req.body?.paymentStatus);

      sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Payment status updated',
            data: result,
      });
});

const deletePayment = catchAsync(async (req, res) => {
      const result = await paymentService.deletePayment(req.params.id as string);

      sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Payment deleted',
            data: result,
      });
});

export default {
      createPayment,
      myPosWebhook,
      myPosSuccessReturn: redirectFromMyPos('success'),
      myPosCancelReturn: redirectFromMyPos('cancel'),
      getMyPayments,
      getAllPayments,
      updatePaymentStatus,
      deletePayment,
};
