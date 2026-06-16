import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { Invoice } from '../invoice/invoice.model';

interface IDashboardStats {
      totalSales: number;
      totalProfit: number;
      totalOrders: number;
      avgOrderValue: number;
      salesGrowth: number;
      profitGrowth: number;
      ordersGrowth: number;
      avgOrderGrowth: number;
}

interface IPeriodData {
      totalSales: number;
      totalProfit: number;
      totalOrders: number;
      avgOrderValue: number;
}

const getDateRange = (filter: 'daily' | 'monthly' | 'yearly') => {
      const now = new Date();
      const start = new Date();
      const end = new Date();

      switch (filter) {
            case 'daily':
                  start.setHours(0, 0, 0, 0);
                  end.setHours(23, 59, 59, 999);
                  break;
            case 'monthly':
                  start.setDate(1);
                  start.setHours(0, 0, 0, 0);
                  end.setMonth(end.getMonth() + 1);
                  end.setDate(0);
                  end.setHours(23, 59, 59, 999);
                  break;
            case 'yearly':
                  start.setMonth(0, 1);
                  start.setHours(0, 0, 0, 0);
                  end.setMonth(11, 31);
                  end.setHours(23, 59, 59, 999);
                  break;
            default:
                  throw new AppError('Invalid filter type', StatusCodes.BAD_REQUEST);
      }

      return { start, end };
};

const getPreviousPeriodRange = (filter: 'daily' | 'monthly' | 'yearly') => {
      const now = new Date();
      const start = new Date();
      const end = new Date();

      switch (filter) {
            case 'daily':
                  start.setDate(start.getDate() - 1);
                  start.setHours(0, 0, 0, 0);
                  end.setDate(end.getDate() - 1);
                  end.setHours(23, 59, 59, 999);
                  break;
            case 'monthly':
                  start.setMonth(start.getMonth() - 1);
                  start.setDate(1);
                  start.setHours(0, 0, 0, 0);
                  end.setMonth(end.getMonth());
                  end.setDate(0);
                  end.setHours(23, 59, 59, 999);
                  break;
            case 'yearly':
                  start.setFullYear(start.getFullYear() - 1);
                  start.setMonth(0, 1);
                  start.setHours(0, 0, 0, 0);
                  end.setFullYear(end.getFullYear() - 1);
                  end.setMonth(11, 31);
                  end.setHours(23, 59, 59, 999);
                  break;
            default:
                  throw new AppError('Invalid filter type', StatusCodes.BAD_REQUEST);
      }

      return { start, end };
};

const calculateStats = async (startDate: Date, endDate: Date): Promise<IPeriodData> => {
      const result = await Invoice.aggregate([
            {
                  $match: {
                        createdAt: { $gte: startDate, $lte: endDate },
                        totalAmount: { $ne: null },
                  },
            },
            {
                  $group: {
                        _id: null,
                        totalSales: { $sum: '$totalAmount' },
                        totalOrders: { $sum: 1 },
                        avgOrderValue: { $avg: '$totalAmount' },
                        // Note: You need to add a 'cost' field to your invoice schema for profit calculation
                        // totalProfit: { $sum: { $subtract: ['$totalAmount', '$cost'] } },
                  },
            },
      ]);

      if (result.length === 0) {
            return {
                  totalSales: 0,
                  totalProfit: 0,
                  totalOrders: 0,
                  avgOrderValue: 0,
            };
      }

      return {
            totalSales: result[0].totalSales || 0,
            totalProfit: 0, // Will calculate if cost field exists
            totalOrders: result[0].totalOrders || 0,
            avgOrderValue: result[0].avgOrderValue || 0,
      };
};

const calculateGrowth = (current: number, previous: number): number => {
      if (previous === 0) return 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

const getDashboardStats = async (
      shopkeeperId?: string,
      filter: 'daily' | 'monthly' | 'yearly' = 'monthly'
): Promise<IDashboardStats> => {
      const { start, end } = getDateRange(filter);
      const { start: prevStart, end: prevEnd } = getPreviousPeriodRange(filter);

      // Build match condition for shopkeeper if provided
      const matchCondition: any = {
            createdAt: { $gte: start, $lte: end },
            totalAmount: { $ne: null },
      };

      const prevMatchCondition: any = {
            createdAt: { $gte: prevStart, $lte: prevEnd },
            totalAmount: { $ne: null },
      };

      if (shopkeeperId) {
            if (!Types.ObjectId.isValid(shopkeeperId)) {
                  throw new AppError('Invalid shopkeeperId', StatusCodes.BAD_REQUEST);
            }
            matchCondition.shopkeeperId = new Types.ObjectId(shopkeeperId);
            prevMatchCondition.shopkeeperId = new Types.ObjectId(shopkeeperId);
      }

      // Current period stats
      const currentStats = await Invoice.aggregate([
            { $match: matchCondition },
            {
                  $group: {
                        _id: null,
                        totalSales: { $sum: '$totalAmount' },
                        totalOrders: { $sum: 1 },
                        avgOrderValue: { $avg: '$totalAmount' },
                  },
            },
      ]);

      // Previous period stats
      const previousStats = await Invoice.aggregate([
            { $match: prevMatchCondition },
            {
                  $group: {
                        _id: null,
                        totalSales: { $sum: '$totalAmount' },
                        totalOrders: { $sum: 1 },
                        avgOrderValue: { $avg: '$totalAmount' },
                  },
            },
      ]);

      const current = currentStats[0] || { totalSales: 0, totalOrders: 0, avgOrderValue: 0 };
      const previous = previousStats[0] || { totalSales: 0, totalOrders: 0, avgOrderValue: 0 };

      return {
            totalSales: current.totalSales || 0,
            totalProfit: 0, // Will implement when cost field is added
            totalOrders: current.totalOrders || 0,
            avgOrderValue: current.avgOrderValue || 0,
            salesGrowth: calculateGrowth(current.totalSales || 0, previous.totalSales || 0),
            profitGrowth: 0, // Will implement when cost field is added
            ordersGrowth: calculateGrowth(current.totalOrders || 0, previous.totalOrders || 0),
            avgOrderGrowth: calculateGrowth(current.avgOrderValue || 0, previous.avgOrderValue || 0),
      };
};

const dashboardService = {
      getDashboardStats,
};

export default dashboardService;
