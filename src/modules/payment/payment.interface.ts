import { Types } from 'mongoose';

export type TPaymentStatus = 'pending' | 'paid' | 'failed';

export interface IPayment {
      userId: Types.ObjectId;
      subscriptionId?: Types.ObjectId;

      amount: number;
      currency: string;

      myPosOrderId?: string;
      myPosTransactionRef?: string;

      paymentStatus: TPaymentStatus;

      paymentMethod?: string;

      createdAt?: Date;
      updatedAt?: Date;
}
