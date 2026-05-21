import { Types } from 'mongoose';

export interface ICustomer {
      firstName: string;
      lastName?: string;
      email?: string;
      phone?: string;
      address?: string;
      shopkeeperId?: Types.ObjectId;
      salesMethod?: string;
      actualSalePrice?: number;
      paymentType?: string;
      alreadyPaid?: number;
      customerId?: string;
      createdAt?: Date;
      updatedAt?: Date;
}
