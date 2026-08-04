import { Schema, model } from 'mongoose';
import { IPayment } from './payment.interface';

const paymentSchema = new Schema<IPayment>(
      {
            userId: {
                  type: Schema.Types.ObjectId,
                  ref: 'User',
                  required: true,
            },
            subscriptionId: {
                  type: Schema.Types.ObjectId,
                  ref: 'Subscription',
            },
            amount: {
                  type: Number,
                  required: true,
            },
            currency: {
                  type: String,
                  default: 'usd',
            },
            myPosOrderId: {
                  type: String,
                  unique: true,
                  sparse: true,
            },
            myPosTransactionRef: String,
            paymentStatus: {
                  type: String,
                  enum: ['pending', 'paid', 'failed'],
                  default: 'pending',
            },
            paymentMethod: String,
      },
      {
            timestamps: true,
            versionKey: false,
      }
);

export const Payment = model<IPayment>('Payment', paymentSchema);
