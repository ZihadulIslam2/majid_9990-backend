import { randomBytes, sign, verify } from 'crypto';
import config from '../../config/config';
import AppError from '../../errors/AppError';
import Subscription from '../subscription/subscription.model';
import { User } from '../user/user.model';
import { creditUserBalance } from './balanceTransaction.service';
import { Payment } from './payment.model';
import { TPaymentStatus } from './payment.interface';

type MyPosParameters = Record<string, string>;

const normalizePem = (value: string) => value.replace(/\\n/g, '\n');

const getMyPosConfiguration = () => {
      const mypos = config.mypos;
      const requiredValues = {
            MYPOS_STORE_ID: mypos.storeId,
            MYPOS_WALLET_NUMBER: mypos.walletNumber,
            MYPOS_KEY_INDEX: mypos.keyIndex,
            MYPOS_PRIVATE_KEY: mypos.privateKey,
            MYPOS_API_PUBLIC_CERT: mypos.apiPublicCertificate,
            MYPOS_CHECKOUT_URL: mypos.checkoutUrl,
            MYPOS_CALLBACK_BASE_URL: mypos.callbackBaseUrl,
            FRONTEND_URL: config.frontend_url,
      };

      const missing = Object.entries(requiredValues)
            .filter(([, value]) => !value)
            .map(([name]) => name);

      if (missing.length > 0) {
            throw new AppError(`myPOS is not configured. Missing: ${missing.join(', ')}.`, 500);
      }

      return {
            storeId: mypos.storeId as string,
            walletNumber: mypos.walletNumber as string,
            keyIndex: mypos.keyIndex as string,
            privateKey: normalizePem(mypos.privateKey as string),
            apiPublicCertificate: normalizePem(mypos.apiPublicCertificate as string),
            checkoutUrl: mypos.checkoutUrl as string,
            callbackBaseUrl: removeTrailingSlash(mypos.callbackBaseUrl as string),
            frontendUrl: removeTrailingSlash(config.frontend_url as string),
            currency: mypos.currency.toUpperCase(),
            language: mypos.language.toUpperCase(),
      };
};

const removeTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const assertHttpsCallbackUrl = (value: string, name: string) => {
      let parsed: URL;

      try {
            parsed = new URL(value);
      } catch {
            throw new AppError(`${name} must be a valid public HTTPS URL.`, 500);
      }

      if (parsed.protocol !== 'https:' || parsed.port) {
            throw new AppError(`${name} must use HTTPS and must not include a port.`, 500);
      }
};

const serializeSignaturePayload = (parameters: MyPosParameters) =>
      Buffer.from(Object.entries(parameters).map(([, value]) => value).join('-')).toString('base64');

const signMyPosParameters = (parameters: MyPosParameters, privateKey: string) =>
      sign('RSA-SHA256', Buffer.from(serializeSignaturePayload(parameters)), privateKey).toString('base64');

const verifyMyPosSignature = (parameters: Record<string, unknown>, publicCertificate: string) => {
      const signature = parameters.Signature;

      if (typeof signature !== 'string' || !signature || Object.keys(parameters).at(-1) !== 'Signature') {
            return false;
      }

      const unsignedParameters: MyPosParameters = {};

      for (const [key, value] of Object.entries(parameters)) {
            if (key === 'Signature') continue;

            if (typeof value !== 'string') {
                  return false;
            }

            unsignedParameters[key] = value;
      }

      try {
            return verify(
                  'RSA-SHA256',
                  Buffer.from(serializeSignaturePayload(unsignedParameters)),
                  publicCertificate,
                  Buffer.from(signature, 'base64')
            );
      } catch {
            return false;
      }
};

const toMinorUnitSafeAmount = (amount: number) => Math.round(amount * 100) / 100;

const creditPaymentBalance = async (payment: any) => {
      const user = await User.findById(payment.userId);

      let creditUserId = payment.userId.toString();

      if (user) {
            if (user.role === 'user') {
                  await User.findByIdAndUpdate(payment.userId, { role: 'shopkeeper' });
            } else if (user.role === 'staff') {
                  if (!user.shopkeeperId) {
                        throw new AppError('Staff user has no associated shopkeeper', 400);
                  }
                  creditUserId = user.shopkeeperId.toString();
            }
      }

      await creditUserBalance({
            userId: creditUserId,
            amount: payment.amount,
            currency: payment.currency,
            source: 'payment',
            description: `Balance credited from myPOS payment ${payment.myPosOrderId ?? ''}`.trim(),
            referenceId: payment._id.toString(),
            paymentId: payment._id.toString(),
      });
};

const markPaymentAsPaid = async (payment: any, transactionReference: string) => {
      const updatedPayment = await Payment.findOneAndUpdate(
            { _id: payment._id, paymentStatus: { $ne: 'paid' } },
            {
                  paymentStatus: 'paid',
                  paymentMethod: 'myPOS',
                  myPosTransactionRef: transactionReference,
            },
            { new: true }
      );

      if (updatedPayment) {
            await creditPaymentBalance(updatedPayment);
      }
};

const createPaymentSession = async (user: any, payload: { subscriptionId?: string }) => {
      const { subscriptionId } = payload;

      if (!subscriptionId) {
            throw new AppError('A subscription plan is required to create a payment.', 400);
      }

      const subscription = await Subscription.findById(subscriptionId);

      if (!subscription || !subscription.isAvailable || subscription.customPricing) {
            throw new AppError('This subscription plan is not available for online payment.', 400);
      }

      const amount = toMinorUnitSafeAmount(subscription.price);

      if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('The subscription plan must have a valid price.', 400);
      }

      const mypos = getMyPosConfiguration();
      assertHttpsCallbackUrl(mypos.callbackBaseUrl, 'MYPOS_CALLBACK_BASE_URL');
      assertHttpsCallbackUrl(mypos.frontendUrl, 'FRONTEND_URL');

      const orderId = `MYP-${Date.now()}-${randomBytes(6).toString('hex')}`;
      const paymentPath = `${mypos.callbackBaseUrl}/api/v1/payment`;
      const amountAsString = amount.toFixed(2);
      const itemName = subscription.name.slice(0, 255);

      const parameters: MyPosParameters = {
            IPCmethod: 'IPCPurchase',
            IPCVersion: '1.4',
            IPCLanguage: mypos.language,
            SID: mypos.storeId,
            WalletNumber: mypos.walletNumber,
            Amount: amountAsString,
            Currency: mypos.currency,
            OrderID: orderId,
            URL_OK: `${paymentPath}/return/success`,
            URL_Cancel: `${paymentPath}/return/cancel`,
            URL_Notify: `${paymentPath}/webhook`,
            CardTokenRequest: '0',
            KeyIndex: mypos.keyIndex,
            PaymentParametersRequired: '1',
            CustomerEmail: user.email,
            CustomerFirstNames: user.firstName || 'Customer',
            CustomerFamilyName: user.lastName || '-',
            CustomerPhone: user.phone || '',
            Note: `Subscription: ${subscription.name}`,
            CartItems: '1',
            Article_1: itemName,
            Quantity_1: '1',
            Price_1: amountAsString,
            Currency_1: mypos.currency,
            Amount_1: amountAsString,
      };

      parameters.Signature = signMyPosParameters(parameters, mypos.privateKey);

      await Payment.create({
            userId: user._id,
            subscriptionId: subscription._id,
            amount,
            currency: mypos.currency,
            myPosOrderId: orderId,
            paymentStatus: 'pending',
            paymentMethod: 'myPOS',
      });

      return {
            actionUrl: mypos.checkoutUrl,
            params: parameters,
            orderId,
      };
};

const handleMyPosNotification = async (payload: Record<string, unknown>) => {
      const mypos = getMyPosConfiguration();

      if (payload.IPCmethod !== 'IPCPurchaseNotify' || payload.SID !== mypos.storeId) {
            throw new AppError('Invalid myPOS payment notification.', 400);
      }

      if (!verifyMyPosSignature(payload, mypos.apiPublicCertificate)) {
            throw new AppError('Invalid myPOS payment notification signature.', 400);
      }

      const orderId = payload.OrderID;
      const amount = payload.Amount;
      const currency = payload.Currency;
      const transactionReference = payload.IPC_Trnref;

      if (
            typeof orderId !== 'string' ||
            typeof amount !== 'string' ||
            typeof currency !== 'string' ||
            typeof transactionReference !== 'string'
      ) {
            throw new AppError('Invalid myPOS payment notification payload.', 400);
      }

      const payment = await Payment.findOne({ myPosOrderId: orderId });

      if (!payment) {
            throw new AppError('Payment order was not found.', 404);
      }

      const notifiedAmount = Number(amount);

      if (
            !Number.isFinite(notifiedAmount) ||
            payment.amount.toFixed(2) !== notifiedAmount.toFixed(2) ||
            payment.currency !== currency.toUpperCase()
      ) {
            throw new AppError('myPOS payment notification does not match the payment order.', 400);
      }

      await markPaymentAsPaid(payment, transactionReference);
};

const getMyPayments = async (userId: string) => {
      return await Payment.find({ userId }).sort({ createdAt: -1 });
};

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
                  description: `Balance credited from admin payment update ${payment.myPosOrderId ?? payment._id.toString()}`.trim(),
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
      handleMyPosNotification,
      getMyPayments,
      getAllPayments,
      updatePaymentStatus,
      deletePayment,
};
