import Stripe from 'stripe';
import config from '../../config/config';
import AppError from '../../errors/AppError';
import { Payment } from './payment.model';
import { creditUserBalance } from './balanceTransaction.service';
import { TPaymentStatus } from './payment.interface';

let stripeClient: InstanceType<typeof Stripe> | null = null;

const getStripeClient = () => {
      if (stripeClient) return stripeClient;

      const stripeSecretKey = (config as { stripe_secret_key?: string }).stripe_secret_key;

      if (!stripeSecretKey) {
            throw new AppError('Stripe is not configured. Missing STRIPE_SECRET_KEY.', 500);
      }

      stripeClient = new Stripe(stripeSecretKey, {
            apiVersion: '2026-04-22.dahlia',
      });

      return stripeClient;
};

// ✅ Create Checkout Session
const createPaymentSession = async (user: any, payload: any) => {
      const stripe = getStripeClient();
      const { amount, subscriptionId } = payload;
      const frontendUrl = (config as { frontend_url?: string }).frontend_url ?? '';

      const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            success_url: `${frontendUrl}/success`,
            cancel_url: `${frontendUrl}/cancel`,
            customer_email: user.email,

            line_items: [
                  {
                        price_data: {
                              currency: 'usd',
                              product_data: {
                                    name: 'Subscription Payment',
                              },
                              unit_amount: amount * 100, // cents
                        },
                        quantity: 1,
                  },
            ],

            metadata: {
                  userId: user._id.toString(),
                  subscriptionId: subscriptionId || '',
            },
      });

      // save pending payment
      await Payment.create({
            userId: user._id,
            subscriptionId,
            amount,
            currency: 'usd',
            stripeSessionId: session.id,
            paymentStatus: 'pending',
      });

      return session;
};

// Handle Webhook
const handleStripeWebhook = async (event: any) => {
      if (event.type === 'checkout.session.completed') {
            const session: any = event.data.object;

            const payment = await Payment.findOneAndUpdate(
                  { stripeSessionId: session.id, paymentStatus: { $ne: 'paid' } },
                  {
                        paymentStatus: 'paid',
                        stripePaymentIntentId: session.payment_intent,
                        paymentMethod: session.payment_method_types?.[0],
                  },
                  { new: true }
            );

            if (payment) {
                  await creditUserBalance({
                        userId: payment.userId.toString(),
                        amount: payment.amount,
                        currency: payment.currency,
                        source: 'payment',
                        description: `Balance credited from payment ${payment.stripeSessionId ?? ''}`.trim(),
                        referenceId: payment._id.toString(),
                        paymentId: payment._id.toString(),
                  });
            }
      }

      if (event.type === 'payment_intent.payment_failed') {
            const intent: any = event.data.object;

            await Payment.findOneAndUpdate(
                  { stripePaymentIntentId: intent.id },
                  {
                        paymentStatus: 'failed',
                  }
            );
      }
};

// Get My Payments
const getMyPayments = async (userId: string) => {
      return await Payment.find({ userId }).sort({ createdAt: -1 });
};

// Get All Payments (Admin)
const getAllPayments = async () => {
      return await Payment.find().populate('userId subscriptionId').sort({ createdAt: -1 });
};

const updatePaymentStatus = async (paymentId: string, nextStatus: TPaymentStatus) => {
      const allowedStatuses: TPaymentStatus[] = ['pending', 'paid', 'failed'];

      if (!allowedStatuses.includes(nextStatus)) {
            throw new AppError('Invalid payment status', 400);
      }

      const payment = await Payment.findById(paymentId);

      if (!payment) {
            throw new AppError('Payment not found', 404);
      }

      if (payment.paymentStatus === nextStatus) {
            return await Payment.findById(paymentId).populate('userId subscriptionId');
      }

      if (payment.paymentStatus === 'paid' && nextStatus !== 'paid') {
            throw new AppError('Paid payments cannot be moved back to another status.', 400);
      }

      payment.paymentStatus = nextStatus;

      if (nextStatus === 'paid') {
            await creditUserBalance({
                  userId: payment.userId.toString(),
                  amount: payment.amount,
                  currency: payment.currency,
                  source: 'payment',
                  description: `Balance credited from admin payment update ${payment.stripeSessionId ?? payment._id.toString()}`.trim(),
                  referenceId: payment._id.toString(),
                  paymentId: payment._id.toString(),
            });
      }

      await payment.save();

      return await Payment.findById(paymentId).populate('userId subscriptionId');
};

const deletePayment = async (paymentId: string) => {
      const payment = await Payment.findById(paymentId);

      if (!payment) {
            throw new AppError('Payment not found', 404);
      }

      if (payment.paymentStatus === 'paid') {
            throw new AppError('Paid payments cannot be deleted.', 400);
      }

      await payment.deleteOne();

      return { _id: paymentId };
};

export default {
      createPaymentSession,
      handleStripeWebhook,
      getMyPayments,
      getAllPayments,
      updatePaymentStatus,
      deletePayment,
};
