export type TransactionType = 'BUY' | 'SELL';
export type AssetCategory = 'STOCKS' | 'FII' | 'FIXED' | 'ETF' | 'GOV';

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  ticker: string;
  quantity: number;
  price: number;
  total: number;
  fee?: number;
}

export interface LivePrice {
  price: number;
  change: number;
  changePct: number;
  name: string;
  isLive: boolean;
  sym: string;
  timestamp: number;
  prevClose: number;
  currency: string;
}

export interface Asset {
  ticker: string;
  name: string;
  category: AssetCategory;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  isLive: boolean;
  invested: number;
  marketValue: number;
  unrealized: number;
  realizedProfit: number;
  color: string;
  operations: number;
  dailyChange: number;
  changePct: number;
  prevClose: number;
}

export interface Dividend {
  id: string;
  ticker: string;
  date: string;
  amount: number;
  quantity: number;
  total: number;
  currency: string;
}

export interface Stats {
  totalInvested: number;
  marketValue: number;
  unrealizedProfit: number;
  realizedProfit: number;
  totalDividends: number;
  totalBuys: number;
  totalSells: number;
  profitability: number;
  operationsCount: number;
  assetsCount: number;
  assets: Asset[];
  dailyChange: number;
  dailyChangePct: number;
}
