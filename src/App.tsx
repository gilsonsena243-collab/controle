/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Plus, Search, RefreshCw, BarChart3, PieChart, 
  ArrowUpRight, ArrowDownRight, Wallet, History, 
  Target, TrendingUp, Settings, Trash2, Edit2, 
  X, ChevronRight, ChevronDown, Sun, Moon, Download, Upload,
  Info, AlertCircle, CheckCircle2, Briefcase,
  FileJson, FileText, Filter, Building2, Globe, Zap, Percent, Calendar, Library
} from 'lucide-react';
import { read, utils } from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Chart as ChartJS, 
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title,
  Filler,
  DoughnutController
} from 'chart.js';
import { Doughnut, Line, Bar } from 'react-chartjs-2';
import { cn } from './lib/utils';
import { CATALOG, COLORS, DEFAULT_TRANSACTIONS, DEFAULT_EVOLUTION } from './constants';
import { Transaction, LivePrice, Asset, Stats, TransactionType, AssetCategory, Dividend } from './types';

ChartJS.register(
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title,
  Filler,
  DoughnutController
);

const PRICE_TTL = 15 * 60 * 1000; // 15 min

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, LivePrice>>({});
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState('visao');
  const [isDark, setIsDark] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currency, setCurrency] = useState<'USD' | 'BRL'>(() => {
    const saved = localStorage.getItem('gp-currency');
    return (saved as 'USD' | 'BRL') || 'USD';
  });
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<LivePrice | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [assetCategories, setAssetCategories] = useState<Record<string, AssetCategory>>({});
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [usdbrl, setUsdbrl] = useState(() => {
    const saved = localStorage.getItem('gp-usdbrl');
    return saved ? JSON.parse(saved) : 5.4; // Better default than 1
  });
  const [isModalAddOpen, setIsModalAddOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [indices, setIndices] = useState<Record<string, any>>({});
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  // Initial Load - Run ONLY ONCE
  useEffect(() => {
    const savedTxns = localStorage.getItem('gp-txns-v2');
    if (savedTxns) setTransactions(JSON.parse(savedTxns));

    const savedPrices = localStorage.getItem('gp-prices');
    if (savedPrices) setLivePrices(JSON.parse(savedPrices));

    const savedMetas = localStorage.getItem('gp-metas');
    if (savedMetas) setMetas(JSON.parse(savedMetas));

    const savedCategories = localStorage.getItem('gp-asset-categories');
    if (savedCategories) setAssetCategories(JSON.parse(savedCategories));

    const savedDividends = localStorage.getItem('gp-dividends');
    if (savedDividends) setDividends(JSON.parse(savedDividends));

    const savedTheme = localStorage.getItem('gp-theme');
    if (savedTheme === 'light') setIsDark(false);

    // Initial Fetch USD/BRL rate
    fetchPrice('USDBRL=X').then(res => {
      if (res) setUsdbrl(res.price);
    });

    // Initial Fetch Indices
    ['^BVSP', '^GSPC'].forEach(idx => {
      fetch(`/api/index/${idx}`)
        .then(r => {
          if (!r.ok) throw new Error(`Index fetch failed: ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (data?.chart?.result?.[0]) {
            setIndices(prev => ({ ...prev, [idx]: data.chart.result[0] }));
          }
        })
        .catch(err => console.warn(`Error fetching index ${idx}:`, err));
    });
  }, []);

  // Background Sync and Periodic Updates
  useEffect(() => {
    // Initial delay for first refresh
    const timeout = setTimeout(() => {
      refreshAllPrices();
    }, 2000);

    const interval = setInterval(() => {
      refreshAllPrices();
    }, 60000);

    // Auto-sync dividends if empty but have transactions
    if (transactions.length > 0 && dividends.length === 0) {
      setTimeout(() => syncAllDividends(), 5000);
    }
    
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [transactions.length, dividends.length > 0]);

  // Save data
  useEffect(() => {
    localStorage.setItem('gp-txns-v2', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('gp-prices', JSON.stringify(livePrices));
  }, [livePrices]);

  useEffect(() => {
    localStorage.setItem('gp-metas', JSON.stringify(metas));
  }, [metas]);

  useEffect(() => {
    localStorage.setItem('gp-asset-categories', JSON.stringify(assetCategories));
  }, [assetCategories]);

  useEffect(() => {
    localStorage.setItem('gp-dividends', JSON.stringify(dividends));
  }, [dividends]);

  useEffect(() => {
    localStorage.setItem('gp-usdbrl', JSON.stringify(usdbrl));
  }, [usdbrl]);

  useEffect(() => {
    localStorage.setItem('gp-currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('gp-theme', isDark ? 'dark' : 'light');
    if (isDark) document.documentElement.classList.remove('light');
    else document.documentElement.classList.add('light');
  }, [isDark]);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const syncAllDividends = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    addToast('Sincronizando proventos...', 'info');
    
    try {
      const uniqueTickers = Array.from(new Set(transactions.map(t => {
        let tk = t.ticker.toUpperCase();
        // Brazilian stocks: 5-6 chars ending in digit, no dot
        if (/^[A-Z]{4}[3456][0-9]?$/.test(tk)) tk += '.SA';
        return tk;
      }))) as string[];
      const newDividends: Dividend[] = [];

      for (const ticker of uniqueTickers) {
        try {
          const res = await fetch(`/api/dividends/${ticker}`);
          if (!res.ok) continue;
          const data = await res.json();
          const result = data?.chart?.result?.[0];
          const events = result?.events?.dividends;
          const metaCurrency = result?.meta?.currency || (ticker.endsWith('.SA') ? 'BRL' : 'USD');
          
          if (!events) continue;

          // Unique transactions for this ticker (normalized)
          const tickerTransactions = transactions
            .filter(t => {
              let tk = t.ticker.toUpperCase();
              if (/^[A-Z]{4}[3456][0-9]?$/.test(tk)) tk += '.SA';
              return tk === ticker;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          Object.values(events).forEach((div: any, idx: number) => {
            // div.date is Ex-Dividend Date (timestamp)
            const divDate = new Date(div.date * 1000);
            const divDateStr = divDate.toISOString().split('T')[0];
            
            // Normalize to start of day UTC for comparison
            const divDayUTC = Date.UTC(divDate.getUTCFullYear(), divDate.getUTCMonth(), divDate.getUTCDate());
            
            // Calculate quantity held at "Data COM" (day before Ex-Date)
            let qtyAtDate = 0;
            for (const tx of tickerTransactions) {
              const txDate = new Date(tx.date);
              // Transaction day start UTC
              const txDayUTC = Date.UTC(txDate.getUTCFullYear(), txDate.getUTCMonth(), txDate.getUTCDate());
              
              // If transaction happened BEFORE the Ex-Date, it was owned on Data COM
              if (txDayUTC < divDayUTC) {
                if (tx.type === 'BUY') qtyAtDate += tx.quantity;
                else qtyAtDate -= tx.quantity;
              }
            }

            if (qtyAtDate > 0.01) {
              const divKey = `${ticker}-${divDateStr}-${div.amount}`;
              const exists = newDividends.some(d => `${d.ticker}-${d.date}-${d.amount}` === divKey);
              
              if (!exists) {
                // Unique ID using timestamp and index to handle same-day dividends (Div + JCP)
                const id = `${ticker}-${div.date}-${idx}`;
                newDividends.push({
                  id,
                  ticker,
                  date: divDateStr,
                  amount: div.amount,
                  quantity: qtyAtDate,
                  total: div.amount * qtyAtDate,
                  currency: metaCurrency
                });
              }
            }
          });
        } catch (err) {
          console.error(`Error syncing dividends for ${ticker}`, err);
        }
      }

      setDividends(newDividends);
      addToast(`${newDividends.length} proventos sincronizados!`, 'success');
    } catch (err) {
      addToast('Erro ao sincronizar proventos', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchPrice = async (symbol: string) => {
    try {
      const res = await fetch(`/api/price/${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        console.warn(`Fetch failed for ${symbol}: ${res.status}`);
        return null;
      }
      const data = await res.json();
      
      const quote = data?.quoteResponse?.result?.[0];
      if (!quote) {
        console.warn(`Invalid quote data for ${symbol}`);
        return null;
      }

      const price = quote.regularMarketPrice;
      const change = quote.regularMarketChange || 0;
      const name = quote.longName || quote.shortName || CATALOG[symbol.toUpperCase()]?.name || symbol;
      
      return {
        price: quote.currency === 'GBp' ? price / 100 : price,
        change,
        changePct: quote.regularMarketChangePercent || 0,
        name,
        isLive: true,
        sym: symbol,
        timestamp: Date.now(),
        prevClose: price - change,
        currency: quote.currency || 'USD'
      } as LivePrice;
    } catch (e) {
      console.error(`Error in fetchPrice for ${symbol}:`, e);
      return null;
    }
  };

  const fetchPrices = async (symbols: string[]) => {
    if (symbols.length === 0) return {};
    try {
      const res = await fetch(`/api/price/${symbols.join(',')}`);
      if (!res.ok) {
        console.warn(`Batch fetch failed (${res.status}), attempting individual fallback...`);
        const individualResults: Record<string, LivePrice> = {};
        for (const sym of symbols) {
          const p = await fetchPrice(sym);
          if (p) individualResults[sym] = p;
          if (symbols.length > 5) await new Promise(r => setTimeout(r, 100));
        }
        return individualResults;
      }
      const data = await res.json();
      
      const results: Record<string, LivePrice> = {};
      const quotes = data?.quoteResponse?.result || [];
      
      quotes.forEach((quote: any) => {
        const symbol = quote.symbol;
        const price = quote.regularMarketPrice;
        const change = quote.regularMarketChange || 0;
        
        results[symbol] = {
          price: quote.currency === 'GBp' ? price / 100 : price,
          change,
          changePct: quote.regularMarketChangePercent || 0,
          name: quote.longName || quote.shortName || symbol,
          isLive: true,
          sym: symbol,
          timestamp: Date.now(),
          prevClose: price - change,
          currency: quote.currency || 'USD'
        };
      });
      return results;
    } catch (e) {
      console.error("Error in fetchPrices:", e);
      return {};
    }
  };

  // Use Refs to avoid stale closures in interval
  const livePricesRef = React.useRef(livePrices);
  const transactionsRef = React.useRef(transactions);
  
  useEffect(() => {
    livePricesRef.current = livePrices;
  }, [livePrices]);

  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  const refreshAllPrices = async (force = false) => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    
    try {
      const baseTickers = Array.from(new Set(transactionsRef.current.map(t => t.ticker))) as string[];
      const tickers = Array.from(new Set([...baseTickers, 'USDBRL=X']));
      
      const toFetch = tickers.filter(t => {
        if (force) return true;
        const current = livePricesRef.current[t];
        return !current || Date.now() - current.timestamp > PRICE_TTL;
      });

      if (toFetch.length > 0) {
        let finalResults: Record<string, LivePrice> = {};
        const chunkSize = 20;
        for (let i = 0; i < toFetch.length; i += chunkSize) {
          const chunk = toFetch.slice(i, i + chunkSize);
          const batchResults = await fetchPrices(chunk);
          if (Object.keys(batchResults).length > 0) {
            finalResults = { ...finalResults, ...batchResults };
          }
          // Small delay between chunks to avoid rate limiting
          if (toFetch.length > chunkSize) await new Promise(r => setTimeout(r, 500));
        }

        if (Object.keys(finalResults).length > 0) {
          setLivePrices(prev => ({ ...prev, ...finalResults }));
          if (finalResults['USDBRL=X']) {
            setUsdbrl(finalResults['USDBRL=X'].price);
          }
        }
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Error refreshing portfolio prices:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    const result = await fetchPrice(searchQuery.toUpperCase());
    setSearchResult(result);
    setIsSearching(false);
  };

  const stats = useMemo(() => {
    const assetsMap: Record<string, any> = {};
    const sortedTxns = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const tx of sortedTxns) {
      const k = tx.ticker;
      if (!assetsMap[k]) assetsMap[k] = { ticker: k, qty: 0, costNative: 0, realizedNative: 0, count: 0 };
      
      const live = livePrices[k];
      const assetCurrency = live?.currency || (k.endsWith('.SA') ? 'BRL' : 'USD');
      assetsMap[k].currency = assetCurrency;

      if (tx.type === 'BUY') {
        assetsMap[k].qty += tx.quantity;
        assetsMap[k].costNative += tx.total + (tx.fee || 0);
      } else {
        const avgPrice = assetsMap[k].qty > 0 ? assetsMap[k].costNative / assetsMap[k].qty : 0;
        const sellNet = tx.total - (tx.fee || 0);
        assetsMap[k].realizedNative += sellNet - (avgPrice * tx.quantity);
        assetsMap[k].qty = Math.max(0, assetsMap[k].qty - tx.quantity);
        assetsMap[k].costNative = assetsMap[k].qty * avgPrice;
      }
      assetsMap[k].count++;
    }

    let i = 0;
    const assets: Asset[] = Object.entries(assetsMap)
      .filter(([, v]) => v.qty > 0.0001)
      .map(([k, v]) => {
        const live = livePrices[k];
        const rawCatalogPrice = CATALOG[k.toUpperCase()]?.price || 0;
        const avgPriceNative = v.costNative / v.qty;
        const rawPrice = live?.price || rawCatalogPrice || avgPriceNative;
        const rawPrevClose = live?.prevClose || (live?.price || rawCatalogPrice) || rawPrice;
        
        const marketValueNative = v.qty * rawPrice;
        const investedNative = v.costNative;
        const unrealizedNative = marketValueNative - investedNative;
        const dailyChangeNative = v.qty * (rawPrice - rawPrevClose);

        // Normalized to USD for global stats
        const toUSDRate = v.currency === 'BRL' ? (1 / usdbrl) : 1;

        return {
          ticker: k,
          name: live?.name || CATALOG[k.toUpperCase()]?.name || k,
          category: (assetCategories[k] || CATALOG[k.toUpperCase()]?.category || 'STOCKS') as AssetCategory,
          qty: v.qty,
          avgPrice: avgPriceNative * toUSDRate, // Avg price in USD
          currentPrice: rawPrice * toUSDRate, // Current price in USD
          isLive: !!live?.isLive,
          invested: investedNative * toUSDRate, // Invested in USD
          marketValue: marketValueNative * toUSDRate, // Market value in USD
          unrealized: unrealizedNative * toUSDRate, // Unrealized in USD
          realizedProfit: v.realizedNative * toUSDRate, // Realized in USD
          color: COLORS[i++ % COLORS.length],
          operations: v.count,
          dailyChange: dailyChangeNative * toUSDRate,
          changePct: live?.changePct || 0,
          prevClose: rawPrevClose * toUSDRate
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);

    const totalMarketValue = assets.reduce((s, a) => s + a.marketValue, 0);
    const totalInvested = assets.reduce((s, a) => s + a.invested, 0);
    const dailyChange = assets.reduce((s, a) => s + a.dailyChange, 0);

    const totalBuys = sortedTxns.filter(t => t.type === 'BUY').reduce((acc, t) => {
      const assetCurrency = (t.ticker.endsWith('.SA') ? 'BRL' : 'USD');
      const rate = assetCurrency === 'BRL' ? (1 / usdbrl) : 1;
      return acc + (t.total + (t.fee || 0)) * rate;
    }, 0);

    const totalSells = sortedTxns.filter(t => t.type === 'SELL').reduce((acc, t) => {
      const assetCurrency = (t.ticker.endsWith('.SA') ? 'BRL' : 'USD');
      const rate = assetCurrency === 'BRL' ? (1 / usdbrl) : 1;
      return acc + (t.total - (t.fee || 0)) * rate;
    }, 0);

    const totalRealizedProfit = Object.values(assetsMap).reduce((s, a: any) => {
       const rate = a.currency === 'BRL' ? (1 / usdbrl) : 1;
       return s + (a.realizedNative * rate);
    }, 0);

    const totalDividends = dividends.reduce((acc, div) => {
       if (new Date(div.date) > new Date()) return acc;
       const isBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
       const rate = isBRL ? (1 / usdbrl) : 1;
       return acc + (div.total * rate);
    }, 0);

    const totalGain = (totalMarketValue - totalInvested) + totalRealizedProfit + totalDividends;

    return {
      totalInvested,
      marketValue: totalMarketValue,
      unrealizedProfit: totalMarketValue - totalInvested,
      realizedProfit: totalRealizedProfit,
      totalDividends,
      totalBuys,
      totalSells,
      profitability: totalBuys > 0 ? (totalGain / totalBuys) * 100 : 0,
      operationsCount: transactions.length,
      assetsCount: assets.length,
      assets,
      dailyChange,
      dailyChangePct: totalMarketValue > 0 ? (dailyChange / (totalMarketValue - dailyChange)) * 100 : 0
    } as Stats;
  }, [transactions, livePrices, usdbrl, assetCategories, dividends]);

  const fmt = (v: number, signed = false) => {
    const isBRL = currency === 'BRL';
    const symbol = isBRL ? 'R$' : '$';
    
    // Convert value if view is BRL (assuming base data in stats is normalized to USD)
    // Actually, let's keep stats in USD and just convert here
    const convertedValue = isBRL ? v * usdbrl : v;

    const abs = symbol + ' ' + Math.abs(convertedValue).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return signed ? (convertedValue >= 0 ? '+' : '-') + abs : (convertedValue < 0 ? '-' : '') + abs;
  };

  const fmtPct = (v: number, signed = false) => {
    const s = Math.abs(v).toFixed(2) + '%';
    return signed ? (v >= 0 ? '+' : '-') + s : s;
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-surface border-b border-border h-20 sticky top-0 z-50 px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-linear-to-br from-sky to-violet rounded-full flex items-center justify-center text-white shadow-lg overflow-hidden">
             <div className="w-full h-full flex items-center justify-center bg-sky/20">
                <div className="w-8 h-8 rounded-full border-2 border-white/80 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white/60"></div>
                </div>
             </div>
          </div>
          <div>
            <h1 className="font-bold text-lg md:text-xl text-text">Portfólio Global</h1>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className={cn("w-2 h-2 rounded-full", isRefreshing ? "bg-sky animate-pulse" : "bg-emerald")}></span>
              <span>
                {isRefreshing 
                  ? 'Atualizando cotações...' 
                  : lastUpdate 
                    ? `Atualizado: ${lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` 
                    : 'Mercado ao vivo'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-surface2 rounded-xl p-1 border border-border2">
            <button 
              onClick={() => setCurrency('USD')}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", currency === 'USD' ? "bg-sky/20 text-sky" : "text-muted")}
            >
              USD
            </button>
            <button 
              onClick={() => setCurrency('BRL')}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", currency === 'BRL' ? "bg-sky/20 text-sky" : "text-muted")}
            >
              BRL
            </button>
          </div>
          
          <button 
            onClick={() => setIsDark(!isDark)}
            className="p-2.5 rounded-xl border border-border2 text-muted hover:text-text hover:border-sky transition-all bg-surface2"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-surface2 border border-border2">
             <span className="w-2 h-2 rounded-full bg-emerald"></span>
             <span className="text-xs text-muted font-medium">{isRefreshing ? 'Atualizando...' : 'Conectado'}</span>
          </div>
        </div>
      </header>

      <nav className="bg-surface border-b border-border sticky top-20 z-40 px-4 md:px-8 flex overflow-x-auto no-scrollbar gap-8">
        {[
          { id: 'visao', label: 'Visão Geral', icon: BarChart3 },
          { id: 'carteira', label: 'Carteira', icon: Wallet },
          { id: 'lancamentos', label: 'Lançamentos', icon: History },
          { id: 'proventos', label: 'Proventos', icon: Percent },
          { id: 'evolucao', label: 'Evolução', icon: TrendingUp },
          { id: 'metas', label: 'Referência', icon: Target },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 py-4 text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap",
              activeTab === tab.id 
                ? "text-sky border-sky" 
                : "text-muted border-transparent hover:text-text"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'visao' && (
              <DashboardOverview 
                stats={stats} 
                fmt={fmt} 
                fmtPct={fmtPct} 
                usdbrl={usdbrl}
                isRefreshing={isRefreshing}
                transactions={transactions}
                dividends={dividends}
                indices={indices}
                onAddRecord={() => {
                  setEditingTransaction(null);
                  setIsModalAddOpen(true);
                }} 
                onRefresh={() => refreshAllPrices(true)}
                searchQuery={searchQuery} 
                setSearchQuery={setSearchQuery} 
                handleSearch={handleSearch} 
                searchResult={searchResult} 
                isSearching={isSearching} 
                onAdd={(t, p) => { 
                  setSearchResult(null); 
                  setActiveTab('lancamentos'); 
                }} 
              />
            )}
            {activeTab === 'carteira' && (
              <PortfolioView 
                stats={stats} 
                fmt={fmt} 
                fmtPct={fmtPct} 
                onUpdateCategory={(ticker: string, cat: AssetCategory) => {
                  setAssetCategories(prev => ({ ...prev, [ticker]: cat }));
                }}
              />
            )}
            {activeTab === 'lancamentos' && (
              <TransactionsHistory 
                transactions={transactions} 
                setTransactions={setTransactions}
                fmt={fmt} 
                fmtPct={fmtPct} 
                currency={currency}
                usdbrl={usdbrl}
                addToast={addToast}
                onImportSuccess={() => refreshAllPrices()}
                onEdit={tx => { setEditingTransaction(tx); setIsModalAddOpen(true); }} 
              />
            )}
            {activeTab === 'proventos' && (
              <DividendsView 
                dividends={dividends} 
                onSync={syncAllDividends}
                isRefreshing={isRefreshing}
                fmt={fmt}
                currency={currency}
                usdbrl={usdbrl}
                transactions={transactions}
              />
            )}
            {activeTab === 'evolucao' && <EvolutionView stats={stats} fmtPct={fmtPct} transactions={transactions} indices={indices} usdbrl={usdbrl} />}
            {activeTab === 'metas' && <StrategyTab stats={stats} metas={metas} setMetas={setMetas} fmt={fmt} fmtPct={fmtPct} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="bg-surface border-t border-border p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-xs text-muted">© 2026 Portfólio Global • Dados de Yahoo Finance</div>
        <div className="flex items-center gap-4">
          <button className="text-xs text-muted hover:text-sky transition-colors">Termos</button>
          <button className="text-xs text-muted hover:text-sky transition-colors">Privacidade</button>
          <button className="text-xs text-muted hover:text-sky transition-colors">Suporte</button>
        </div>
      </footer>

      {/* Modals & Toasts */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-xs px-4">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "p-3 rounded-xl border shadow-lg flex items-center gap-3 bg-surface",
                t.type === 'success' ? "border-emerald/30 text-emerald" : "border-amber/30 text-amber"
              )}
            >
              {t.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span className="text-sm font-medium">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Dialog open={isModalAddOpen} onClose={() => setIsModalAddOpen(false)}>
        <TransactionForm 
          onClose={() => setIsModalAddOpen(false)} 
          onSubmit={tx => {
            if (editingTransaction) {
              setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
              addToast('Operação atualizada');
            } else {
              setTransactions(prev => [...prev, tx]);
              addToast('Operação adicionada');
            }
            setIsModalAddOpen(false);
          }}
          initialData={editingTransaction}
        />
      </Dialog>
    </div>
  );
}

// ─── Component: EvolutionView ─────────────────────────────────────────────
function EvolutionView({ stats, fmtPct, transactions, indices, usdbrl }: { stats: Stats; fmtPct: any; transactions: Transaction[]; indices: Record<string, any>; usdbrl: number }) {
  const [range, setRange] = useState('12 meses');
  const [chartMode, setChartMode] = useState<'BAR' | 'LINE'>('LINE');
  const [comparisonIndices, setComparisonIndices] = useState<string[]>(['PORTFOLIO', '^BVSP']);

  const getRangeMonths = (r: string) => {
    switch(r) {
      case '1 mês': return 1;
      case '3 meses': return 3;
      case '6 meses': return 6;
      case '1 ano': return 12;
      case '12 meses': return 12;
      case '5 anos': return 60;
      default: return 12;
    }
  };

  const monthsToShow = getRangeMonths(range);
  const now = new Date();

  const labels: string[] = [];
  const portfolioData: number[] = [];
  const ibovData: number[] = [];
  const sp500Data: number[] = [];
  const cdiData: number[] = [];

  // Logic to calculate historical rentability correctly
  const sortedTxns = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  const getIndexReturn = (symbol: string, startDate: Date, endDate: Date) => {
    const data = indices[symbol];
    if (!data) return 0;
    const timestamps = data.timestamp;
    const prices = data.indicators.quote[0].close;
    
    const startIdx = timestamps.findIndex((ts: number) => ts * 1000 >= startDate.getTime());
    const endIdx = timestamps.findLastIndex((ts: number) => ts * 1000 <= endDate.getTime());

    const startPrice = getAvailablePrice(prices, startIdx !== -1 ? startIdx : 0, 1) || prices[0];
    const endPrice = getAvailablePrice(prices, endIdx !== -1 ? endIdx : prices.length - 1, -1) || prices[prices.length - 1];

    if (!startPrice || !endPrice) return 0;
    return ((endPrice / startPrice) - 1) * 100;
  };

  const getAvailablePrice = (prices: (number | null)[], startIdx: number, direction: 1 | -1) => {
    let idx = Math.max(0, Math.min(startIdx, prices.length - 1));
    while (idx >= 0 && idx < prices.length) {
      if (prices[idx] !== null) return prices[idx];
      idx += direction;
    }
    return null;
  };

  // We need a baseline date for the selected range
  const rangeStartDate = new Date(now.getFullYear(), now.getMonth() - monthsToShow, 1);

  for (let i = monthsToShow; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

    // Portfolio Return Calculation (approximate for MVP)
    // We simplify: current total return * progress in the range
    // In a real app, this would be (Price_t / Price_start) - 1
    const progress = (monthsToShow - i) / (monthsToShow || 1);
    portfolioData.push(stats.profitability * progress);
    
    ibovData.push(getIndexReturn('^BVSP', rangeStartDate, targetDate));
    sp500Data.push(getIndexReturn('^GSPC', rangeStartDate, targetDate));
    
    // CDI (approx 1% per month)
    cdiData.push(progress * (monthsToShow / 12) * 12.75);
  }

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Carteira',
        data: portfolioData,
        borderColor: '#4ade80',
        backgroundColor: chartMode === 'LINE' ? '#4ade8022' : '#4ade80cc',
        borderWidth: 3,
        pointRadius: 0,
        fill: chartMode === 'LINE',
        tension: 0.4,
        type: chartMode === 'LINE' ? 'line' as const : 'bar' as const,
      },
      ...(comparisonIndices.includes('^BVSP') ? [{
        label: 'IBOV',
        data: ibovData,
        borderColor: '#facc15',
        backgroundColor: '#facc15cc',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.4,
        type: chartMode === 'LINE' ? 'line' as const : 'bar' as const,
      }] : []),
      ...(comparisonIndices.includes('^GSPC') ? [{
        label: 'S&P 500',
        data: sp500Data,
        borderColor: '#bd1fff',
        backgroundColor: '#bd1fffcc',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.4,
        type: chartMode === 'LINE' ? 'line' as const : 'bar' as const,
      }] : []),
      ...(comparisonIndices.includes('CDI') ? [{
        label: 'CDI',
        data: cdiData,
        borderColor: '#38bdf8',
        backgroundColor: '#38bdf8cc',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.4,
        type: chartMode === 'LINE' ? 'line' as const : 'bar' as const,
      }] : [])
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        padding: 12,
        titleFont: { size: 12, weight: 'bold' as const },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: (v: any) => v + '%' } }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
         <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-sky shadow-[0_0_8px_rgba(56,189,248,0.6)]"></span>
            <h3 className="font-bold text-lg">Rentabilidade Comparada</h3>
         </div>
         <div className="flex bg-surface2 border border-border2 rounded-xl p-1">
           <button 
             onClick={() => setChartMode('BAR')}
             className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'BAR' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
           >
             Barras
           </button>
           <button 
             onClick={() => setChartMode('LINE')}
             className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'LINE' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
           >
             Linha
           </button>
         </div>
      </div>

      <div className="bg-surface border border-border2 rounded-2xl p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
             <div className="flex bg-surface2 rounded-xl p-1 border border-border2">
               {['1 mês', '3 meses', '6 meses', '12 meses', '5 anos'].map(r => (
                 <button
                   key={r}
                   onClick={() => setRange(r)}
                   className={cn(
                     "px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap",
                     range === r ? "bg-sky text-white shadow-lg shadow-sky/20" : "text-muted hover:text-text"
                   )}
                 >
                   {r}
                 </button>
               ))}
             </div>
             
             <div className="flex bg-surface2 rounded-xl p-1 border border-border2 ml-2">
                {['^BVSP', '^GSPC', 'CDI'].map(idx => (
                  <button
                    key={idx}
                    onClick={() => setComparisonIndices(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                      comparisonIndices.includes(idx) ? "bg-sky/20 text-sky" : "text-muted hover:text-text"
                    )}
                  >
                    {idx === '^BVSP' ? 'IBOV' : idx === '^GSPC' ? 'S&P' : 'CDI'}
                  </button>
                ))}
             </div>
          </div>

          <div className="flex items-center gap-6">
             <div className="text-right">
                <p className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Rentabilidade Total</p>
                <p className={cn("text-xl font-black", stats.profitability >= 0 ? "text-emerald" : "text-rose")}>
                  {fmtPct(stats.profitability, true)}
                </p>
             </div>
          </div>
        </div>

        <div className="h-[400px] w-full">
           {chartMode === 'BAR' ? (
             <Bar data={chartData as any} options={chartOptions as any} />
           ) : (
             <Line data={chartData as any} options={chartOptions as any} />
           )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
            <PerformanceStat label="Minha Carteira" value={stats.profitability} color="#4ade80" fmtPct={fmtPct} />
            <PerformanceStat label="Ibovespa (IBOV)" value={getIndexReturn('^BVSP', rangeStartDate, now)} color="#facc15" fmtPct={fmtPct} />
            <PerformanceStat label="S&P 500" value={getIndexReturn('^GSPC', rangeStartDate, now)} color="#bd1fff" fmtPct={fmtPct} />
            <PerformanceStat label="CDI (Mock)" value={(monthsToShow / 12) * 12.75} color="#38bdf8" fmtPct={fmtPct} />
        </div>
      </div>
    </div>
  );
}

function PerformanceStat({ label, value, color, fmtPct }: any) {
  return (
    <div className="bg-surface2/50 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }}></div>
        <p className="text-[10px] font-black text-muted uppercase tracking-wider">{label}</p>
      </div>
      <p className={cn("text-lg font-black", value >= 0 ? "text-emerald" : "text-rose")}>
        {fmtPct(value, true)}
      </p>
    </div>
  );
}


// ─── Component: DashboardOverview ──────────────────────────────────────────
function DashboardOverview({ stats, fmt, fmtPct, searchQuery, setSearchQuery, handleSearch, searchResult, isSearching, onAdd, onAddRecord, onRefresh, usdbrl, transactions, dividends, indices, isRefreshing }: { 
  stats: Stats; 
  fmt: any; 
  fmtPct: any; 
  onAddRecord: any;
  onRefresh: any;
  searchQuery: string;
  setSearchQuery: any;
  handleSearch: any;
  searchResult: LivePrice | null;
  isSearching: boolean;
  onAdd: (t: string, p: number) => void;
  usdbrl: number;
  transactions: Transaction[];
  dividends: Dividend[];
  indices: Record<string, any>;
  isRefreshing: boolean;
}) {
  const [evolutionMonths, setEvolutionMonths] = useState(12);
  const [evolutionType, setEvolutionType] = useState('ALL');
  const [chartMode, setChartMode] = useState<'BAR' | 'LINE'>('BAR');
  const [subTab, setSubTab] = useState<'RESUMO' | 'PROVENTOS' | 'PATRIMONIO' | 'RENTABILIDADE'>('RESUMO');

  const categories: Record<AssetCategory, { label: string; icon: any; color: string }> = {
    STOCKS: { label: 'Ações', icon: Zap, color: '#38bdf8' },
    FII: { label: 'FIIs', icon: Building2, color: '#fb923c' },
    FIXED: { label: 'Renda Fixa', icon: Percent, color: '#4ade80' },
    ETF: { label: 'ETFs Intern.', icon: Globe, color: '#bd1fff' },
    GOV: { label: 'Tesouro Direto', icon: FileText, color: '#facc15' },
  };

  const grouped = stats.assets.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {} as Record<AssetCategory, Asset[]>);

  // Evolution logic
  const chartEvolutionData = useMemo(() => {
    const sortedTxns = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sortedTxns.length === 0) return { labels: [], appliedData: [], profitData: [] };

    const firstTxDate = new Date(sortedTxns[0].date);
    const now = new Date();
    
    let monthsToShow = evolutionMonths;
    if (evolutionMonths === 0) { // All time
      monthsToShow = (now.getFullYear() - firstTxDate.getFullYear()) * 12 + (now.getMonth() - firstTxDate.getMonth()) + 1;
      monthsToShow = Math.max(1, monthsToShow);
    }

    const labels: string[] = [];
    const appliedData: number[] = [];
    const profitData: number[] = [];
    const dividendData: number[] = [];
    const ibovData: number[] = [];
    const sp500Data: number[] = [];
    const cdiData: number[] = [];

    // Helper to get index return for a period
    const getIndexReturn = (symbol: string, startDate: Date, endDate: Date) => {
      const data = indices[symbol];
      if (!data) return 1;
      const timestamps = data.timestamp;
      const prices = data.indicators.quote[0].close;
      
      const findFirstNonNull = (arr: (number | null)[], start: number, dir: 1 | -1) => {
        let idx = Math.max(0, Math.min(start, arr.length - 1));
        while (idx >= 0 && idx < arr.length) {
          if (arr[idx] !== null) return arr[idx];
          idx += dir;
        }
        return null;
      };

      const startIdx = timestamps.findIndex((ts: number) => ts * 1000 >= startDate.getTime());
      const endIdx = timestamps.findLastIndex((ts: number) => ts * 1000 <= endDate.getTime());

      const startPrice = findFirstNonNull(prices, startIdx !== -1 ? startIdx : 0, 1);
      const endPrice = findFirstNonNull(prices, endIdx !== -1 ? endIdx : prices.length - 1, -1);

      if (!startPrice || !endPrice) return 1;
      return endPrice / startPrice;
    };

    for (let i = monthsToShow - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));

      const targetDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // End of month
      
      const filteredTxns = sortedTxns.filter(t => {
        const tDate = new Date(t.date);
        const matchDate = tDate <= targetDate;
        if (!matchDate) return false;
        
        if (evolutionType !== 'ALL') {
          const cat = CATALOG[t.ticker.toUpperCase()]?.category || 'STOCKS';
          return cat === evolutionType;
        }
        return true;
      });

      const buys = filteredTxns.filter(t => t.type === 'BUY').reduce((acc, t) => {
        const rate = t.ticker.endsWith('.SA') ? (1 / usdbrl) : 1;
        return acc + (t.total + (t.fee || 0)) * rate;
      }, 0);

      const sells = filteredTxns.filter(t => t.type === 'SELL').reduce((acc, t) => {
        const rate = t.ticker.endsWith('.SA') ? (1 / usdbrl) : 1;
        return acc + (t.total - (t.fee || 0)) * rate;
      }, 0);

      const applied = buys - sells;
      appliedData.push(applied);
      
      const divs = dividends.filter(div => new Date(div.date) <= targetDate).reduce((acc, div) => {
        const isBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
        const rate = isBRL ? (1 / usdbrl) : 1;
        return acc + (div.total * rate);
      }, 0);
      dividendData.push(divs);

      // Better estimation of historical result
      const currentProfit = stats.realizedProfit + stats.unrealizedProfit;
      const profitShare = applied / (stats.totalBuys - stats.totalSells || 1);
      profitData.push(currentProfit * profitShare);

      // Indices (What if applied capital followed Ibov/SP500?)
      const ibovRet = getIndexReturn('^BVSP', firstTxDate, targetDate);
      ibovData.push(applied * ibovRet);

      const spRet = getIndexReturn('^GSPC', firstTxDate, targetDate);
      sp500Data.push(applied * spRet);

      const monthsPassed = (targetDate.getFullYear() - firstTxDate.getFullYear()) * 12 + (targetDate.getMonth() - firstTxDate.getMonth());
      const cdiRet = 1 + (monthsPassed * 0.01); // 1% per month mock
      cdiData.push(applied * cdiRet);
    }

    return { labels, appliedData, profitData, dividendData, ibovData, sp500Data, cdiData };
  }, [transactions, evolutionMonths, evolutionType, usdbrl, stats, dividends, indices]);

  // Chart Data
  const donutData = {
    labels: stats.assets.map(a => a.ticker),
    datasets: [{
      data: stats.assets.map(a => a.marketValue),
      backgroundColor: stats.assets.map(a => a.color),
      borderWidth: 0,
      hoverOffset: 12,
    }]
  };

  const monthlyDividends = useMemo(() => {
    const months: string[] = [];
    const values: number[] = [];
    const now = new Date();
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStr = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      months.push(mStr);
      
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      
      const total = dividends.filter(div => {
        const divDate = new Date(div.date);
        return divDate >= monthStart && divDate <= monthEnd;
      }).reduce((acc, div) => {
        const isBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
        const rate = isBRL ? (1 / usdbrl) : 1;
        return acc + (div.total * rate);
      }, 0);
      
      values.push(total);
    }
    return { labels: months, data: values };
  }, [dividends, usdbrl]);

  const barData = {
    labels: chartEvolutionData.labels,
    datasets: [
      {
        label: 'Valor Aplicado',
        data: chartEvolutionData.appliedData,
        backgroundColor: '#4ade80cc',
        borderRadius: 4,
        stack: 'main'
      },
      {
        label: 'Proventos',
        data: chartEvolutionData.dividendData,
        backgroundColor: '#38bdf8cc',
        borderRadius: 4,
        stack: 'main'
      },
      {
        label: 'Ganho Capital',
        data: chartEvolutionData.profitData,
        backgroundColor: '#4ade8044',
        borderRadius: 4,
        stack: 'main'
      },
      {
        label: 'IBOV',
        data: chartEvolutionData.ibovData,
        borderColor: '#facc15',
        backgroundColor: '#facc15cc',
        borderWidth: 2,
        type: 'line' as const,
        pointRadius: 0,
        fill: false,
        tension: 0.4
      },
      {
        label: 'S&P 500',
        data: chartEvolutionData.sp500Data,
        borderColor: '#bd1fff',
        backgroundColor: '#bd1fffcc',
        borderWidth: 2,
        type: 'line' as const,
        pointRadius: 0,
        fill: false,
        tension: 0.4
      },
      {
        label: 'CDI',
        data: chartEvolutionData.cdiData,
        borderColor: '#38bdf8',
        backgroundColor: '#38bdf8cc',
        borderWidth: 2,
        type: 'line' as const,
        pointRadius: 0,
        fill: false,
        tension: 0.4
      }
    ]
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
          <div className="flex items-center gap-6">
            {[
              { id: 'RESUMO', label: 'Resumo' },
              { id: 'PROVENTOS', label: 'Proventos' },
              { id: 'PATRIMONIO', label: 'Patrimônio' },
              { id: 'RENTABILIDADE', label: 'Rentabilidade' },
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setSubTab(tab.id as any)}
                className={cn(
                  "text-sm font-bold pb-2 border-b-2 transition-all",
                  subTab === tab.id ? "text-text border-sky" : "text-muted border-transparent hover:text-text"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <button 
              onClick={() => onRefresh()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-surface2 border border-border2 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-surface3 transition-all active:scale-95"
            >
              <RefreshCw size={12} className={cn("text-sky", isRefreshing && "animate-spin")} />
              Integração B3
            </button>
            <button 
              onClick={() => onAddRecord()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-sky/90 transition-all shadow-md active:scale-95"
            >
              <Plus size={12} />
              Lançamento
            </button>
          </div>
      </div>

      {/* Seção de Pesquisa de Ativo */}
      <div className="bg-surface border border-border rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1 w-full">
            <div className="flex items-center gap-2 mb-4">
               <Search size={16} className="text-sky" />
               <h3 className="font-extrabold text-sm tracking-tight">Pesquisar Ativo</h3>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={16} />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Ex: AAPL, BTC-USD, PETR4.SA..."
                  className="w-full bg-surface2 border border-border2 rounded-2xl py-3 pl-11 pr-4 text-xs focus:border-sky outline-hidden transition-all placeholder:text-muted2"
                />
              </div>
              <button 
                onClick={handleSearch}
                disabled={isSearching}
                className="bg-sky text-white font-bold px-6 rounded-2xl text-xs transition-all hover:bg-sky/90 active:scale-95 disabled:opacity-50"
              >
                {isSearching ? <RefreshCw size={16} className="animate-spin" /> : "Buscar"}
              </button>
            </div>
          </div>

          {searchResult && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="w-full md:w-auto p-4 bg-surface2 border border-border2 rounded-2xl flex items-center justify-between gap-6"
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-black text-sky mono">{searchResult.sym}</p>
                  <p className="text-[10px] text-muted truncate max-w-[120px]">{searchResult.name}</p>
                </div>
                <div className="h-8 w-px bg-border/20"></div>
                <div className="text-right">
                  <p className="text-sm font-black">
                    {fmt(searchResult.currency === 'BRL' ? searchResult.price / usdbrl : searchResult.price)}
                  </p>
                  <p className={cn("text-[10px] font-bold", searchResult.change >= 0 ? "text-emerald" : "text-rose")}>
                    {fmtPct(searchResult.changePct, true)}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => onAdd(searchResult.sym, searchResult.price)}
                className="p-2.5 bg-emerald/10 hover:bg-emerald/20 text-emerald rounded-xl transition-all"
                title="Adicionar à Carteira"
              >
                <Plus size={16} />
              </button>
            </motion.div>
          )}
        </div>
      </div>

      {/* Summary Row */}
      {(subTab === 'RESUMO' || subTab === 'PROVENTOS' || subTab === 'RENTABILIDADE') && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard 
            title="Patrimônio total" 
            value={fmt(stats.marketValue)} 
            subValue={fmt(stats.totalBuys - stats.totalSells)}
            subLabel="Aporte Líquido"
            pill={`${fmtPct(stats.profitability)}`}
            icon={<Wallet size={20} className="text-muted" />}
          />
          <SummaryCard 
            title="Resultado Global" 
            value={fmt(stats.unrealizedProfit + stats.realizedProfit + stats.totalDividends)} 
            subValue={fmt(stats.unrealizedProfit)}
            subLabel="Ganhos em Aberto"
            extraValue={fmt(stats.realizedProfit + stats.totalDividends)}
            extraLabel="Lucro Tot. (Liq.)"
            variant="profit"
            icon={<TrendingUp size={20} className="text-emerald" />}
          />
          <SummaryCard 
            title="Proventos Acum." 
            value={fmt(stats.totalDividends)} 
            subValue={fmt(stats.totalDividends)}
            subLabel="Total"
            extraValue={fmtPct((stats.totalDividends / (stats.totalBuys || 1)) * 100)}
            extraLabel="Yield on Cost"
            variant="profit"
            icon={<Percent size={20} className="text-sky" />}
          />
          <SummaryCard 
            title="Performance" 
            dualCol
            items={[
              { label: 'Variação', value: fmtPct(stats.dailyChangePct, true), info: fmt(stats.dailyChange, true), trend: stats.dailyChange >= 0 },
              { label: 'Rentabilidade', value: fmtPct(stats.profitability, true), trend: stats.profitability >= 0 }
            ]}
          />
        </div>
      )}

      {/* Main Content Areas */}
      <div className="space-y-6">
        {subTab === 'RESUMO' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-surface border border-border rounded-3xl p-8">
               <div className="flex justify-between items-center mb-10">
                  <h3 className="font-extrabold text-lg tracking-tight">Evolução do Patrimônio</h3>
                  <div className="flex items-center gap-2">
                     <div className="flex bg-surface2 border border-border2 rounded-xl p-1 mr-2">
                       <button 
                         onClick={() => setChartMode('BAR')}
                         className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'BAR' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
                       >
                         Barras
                       </button>
                       <button 
                         onClick={() => setChartMode('LINE')}
                         className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'LINE' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
                       >
                         Linha
                       </button>
                     </div>
                     <select 
                       value={evolutionMonths}
                       onChange={e => setEvolutionMonths(Number(e.target.value))}
                       className="bg-surface2 border border-border2 rounded-xl px-3 py-1.5 text-[10px] font-bold outline-hidden transition-all cursor-pointer hover:border-sky/50"
                     >
                        <option value={6}>6 Meses</option>
                        <option value={12}>12 Meses</option>
                        <option value={24}>24 Meses</option>
                        <option value={0}>Tudo</option>
                     </select>
                     <select 
                       value={evolutionType}
                       onChange={e => setEvolutionType(e.target.value)}
                       className="bg-surface2 border border-border2 rounded-xl px-3 py-1.5 text-[10px] font-bold outline-hidden transition-all cursor-pointer hover:border-sky/50"
                     >
                        <option value="ALL">Todos os tipos</option>
                        {Object.entries(categories).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                     </select>
                  </div>
               </div>
                   <div className="h-[300px] w-full">
                      {chartMode === 'BAR' ? (
                        <Bar 
                          data={barData as any} 
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                              x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                              y: { stacked: true, grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b' } }
                            }
                          } as any} 
                        />
                      ) : (
                        <Line 
                          data={{
                            ...barData,
                            datasets: barData.datasets.map(ds => ({
                              ...ds,
                              type: 'line' as const,
                              fill: ds.label === 'IBOV' || ds.label === 'S&P 500' ? false : true,
                              backgroundColor: ds.label === 'IBOV' || ds.label === 'S&P 500' ? ds.borderColor : ds.backgroundColor,
                              tension: 0.4
                            }))
                          } as any}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                              x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                              y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b' } }
                            }
                          } as any}
                        />
                      )}
                      <div className="flex justify-center flex-wrap gap-4 mt-6">
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 rounded-sm bg-[#4ade80cc]"></span>
                             <span className="text-[10px] font-bold text-muted">Aporte</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 rounded-sm bg-[#38bdf8cc]"></span>
                             <span className="text-[10px] font-bold text-muted">Proventos</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 rounded-sm bg-[#4ade8044]"></span>
                             <span className="text-[10px] font-bold text-muted">Ganhos</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 h-[2px] bg-[#facc15]"></span>
                             <span className="text-[10px] font-bold text-muted">IBOV</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 h-[2px] bg-[#bd1fff]"></span>
                             <span className="text-[10px] font-bold text-muted">S&P 500</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="w-2.5 h-2.5 h-[2px] bg-[#38bdf8]"></span>
                             <span className="text-[10px] font-bold text-muted">CDI</span>
                          </div>
                      </div>
                   </div>
            </div>

            <div className="lg:col-span-4 bg-surface border border-border rounded-3xl p-8 flex flex-col">
               <div className="flex justify-between items-center mb-8">
                  <h3 className="font-extrabold text-lg tracking-tight">Ativos na Carteira</h3>
                  <select 
                    value={evolutionType}
                    onChange={e => setEvolutionType(e.target.value)}
                    className="bg-surface2 border border-border2 rounded-xl px-3 py-1.5 text-[10px] font-bold outline-hidden transition-all"
                  >
                    <option value="ALL">Todos os tipos</option>
                    {Object.entries(categories).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
               </div>
               <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-full max-w-[200px] aspect-square relative">
                     <Doughnut 
                       data={{
                         labels: stats.assets.filter(a => evolutionType === 'ALL' || a.category === evolutionType).map(a => a.ticker),
                         datasets: [{
                           data: stats.assets.filter(a => evolutionType === 'ALL' || a.category === evolutionType).map(a => a.marketValue),
                           backgroundColor: stats.assets.filter(a => evolutionType === 'ALL' || a.category === evolutionType).map(a => a.color),
                           borderWidth: 0,
                           hoverOffset: 12,
                         }]
                       }} 
                       options={{ maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }} 
                     />
                  </div>
                  <div className="w-full mt-8 space-y-2">
                     {Object.entries(categories).map(([k, meta]) => {
                       const assets = grouped[k as AssetCategory] || [];
                       if (assets.length === 0) return null;
                       const val = assets.reduce((s, a) => s + a.marketValue, 0);
                       const pct = (val / (stats.marketValue || 1)) * 100;
                       return (
                         <div key={k} className="flex items-center justify-between group cursor-default">
                            <div className="flex items-center gap-2">
                               <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: meta.color }}></div>
                               <span className="text-[10px] font-bold text-muted group-hover:text-text transition-colors">{meta.label}</span>
                            </div>
                            <span className="font-mono text-[10px] font-bold">{pct.toFixed(2)}%</span>
                         </div>
                       );
                     })}
                  </div>
               </div>
            </div>
          </div>
        )}

        {subTab === 'PROVENTOS' && (
          <div className="bg-surface border border-border rounded-3xl p-8">
            <h3 className="font-extrabold text-lg tracking-tight mb-8">Proventos Recebidos (Mensal)</h3>
            <div className="h-[300px] w-full">
              <Bar 
                data={{
                  labels: monthlyDividends.labels,
                  datasets: [{
                    label: 'Proventos',
                    data: monthlyDividends.data,
                    backgroundColor: '#38bdf8cc',
                    borderRadius: 4,
                  }]
                } as any}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                    y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b' } }
                  }
                } as any}
              />
            </div>
          </div>
        )}

        {subTab === 'PATRIMONIO' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface border border-border rounded-3xl p-8">
              <h3 className="font-extrabold text-lg tracking-tight mb-8">Evolução do Patrimônio</h3>
              <div className="h-[300px] w-full">
                <Line 
                  data={{
                    labels: chartEvolutionData.labels,
                    datasets: [{
                      label: 'Patrimônio',
                      data: chartEvolutionData.appliedData.map((d, i) => d + (chartEvolutionData.profitData[i] || 0)),
                      borderColor: '#38bdf8',
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      fill: true,
                      tension: 0.4
                    }]
                  } as any}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                      y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b' } }
                    }
                  } as any}
                />
              </div>
            </div>
            <div className="bg-surface border border-border rounded-3xl p-8">
              <h3 className="font-extrabold text-lg tracking-tight mb-8">Alocação por Categoria</h3>
              <div className="h-[300px] w-full">
                <Doughnut 
                  data={{
                    labels: Object.keys(grouped).map(k => categories[k as AssetCategory]?.label || k),
                    datasets: [{
                      data: Object.keys(grouped).map(k => (grouped[k as AssetCategory] || []).reduce((s, a) => s + a.marketValue, 0)),
                      backgroundColor: Object.keys(grouped).map(k => categories[k as AssetCategory]?.color || '#ccc'),
                      borderWidth: 0,
                    }]
                  }}
                  options={{ maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }}
                />
              </div>
            </div>
          </div>
        )}

        {subTab === 'RENTABILIDADE' && (
          <div className="space-y-6">
            <div className="bg-surface border border-border rounded-3xl p-8">
               <div className="flex justify-between items-center mb-8">
                  <h3 className="font-extrabold text-lg tracking-tight">Rentabilidade Comparada</h3>
                  <div className="flex bg-surface2 border border-border2 rounded-xl p-1">
                    <button 
                      onClick={() => setChartMode('BAR')}
                      className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'BAR' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
                    >
                      Barras
                    </button>
                    <button 
                      onClick={() => setChartMode('LINE')}
                      className={cn("px-3 py-1 rounded-lg text-[10px] font-bold transition-all", chartMode === 'LINE' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text")}
                    >
                      Linha
                    </button>
                  </div>
               </div>
               <div className="h-[300px] w-full">
                  {chartMode === 'BAR' ? (
                    <Bar 
                      data={{
                        labels: chartEvolutionData.labels,
                        datasets: [
                          { label: 'Minha Carteira', data: chartEvolutionData.appliedData.map((a, i) => (chartEvolutionData.profitData[i] / (a || 1)) * 100), backgroundColor: '#4ade80cc', borderRadius: 4 },
                          { label: 'IBOV', data: chartEvolutionData.ibovData.map((a, i) => (a / (chartEvolutionData.appliedData[i] || 1) - 1) * 100), backgroundColor: '#facc15cc', borderRadius: 4 },
                          { label: 'S&P 500', data: chartEvolutionData.sp500Data.map((a, i) => (a / (chartEvolutionData.appliedData[i] || 1) - 1) * 100), backgroundColor: '#bd1fffcc', borderRadius: 4 }
                        ]
                      } as any} 
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
                        scales: {
                          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                          y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b', callback: (v) => v + '%' } }
                        }
                      } as any} 
                    />
                  ) : (
                    <Line 
                      data={{
                        labels: chartEvolutionData.labels,
                        datasets: [
                          { label: 'Carteira', data: chartEvolutionData.appliedData.map((a, i) => (chartEvolutionData.profitData[i] / (a || 1)) * 100), borderColor: '#4ade80', tension: 0.4, fill: true, backgroundColor: '#4ade8011' },
                          { label: 'IBOV', data: chartEvolutionData.ibovData.map((a, i) => (a / (chartEvolutionData.appliedData[i] || 1) - 1) * 100), borderColor: '#facc15', tension: 0.4 },
                          { label: 'S&P 500', data: chartEvolutionData.sp500Data.map((a, i) => (a / (chartEvolutionData.appliedData[i] || 1) - 1) * 100), borderColor: '#bd1fff', tension: 0.4 }
                        ]
                      } as any}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
                        scales: {
                          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748b' } },
                          y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { font: { size: 9 }, color: '#64748b', callback: (v) => v + '%' } }
                        }
                      } as any}
                    />
                  )}
               </div>
            </div>

            <div className="bg-surface border border-border rounded-3xl p-8">
              <h3 className="font-extrabold text-lg tracking-tight mb-8">Rentabilidade dos Ativos</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stats.assets.sort((a, b) => b.marketValue - a.marketValue).slice(0, 9).map(asset => {
                  const profit = asset.marketValue - asset.invested;
                  const pct = asset.invested > 0 ? (profit / asset.invested) * 100 : 0;
                  return (
                    <div key={asset.ticker} className="p-4 bg-surface2 border border-border2 rounded-2xl">
                       <div className="flex justify-between items-start mb-2">
                         <span className="text-xs font-black text-sky mono">{asset.ticker}</span>
                         <div className={cn("text-[10px] font-extrabold px-2 py-0.5 rounded-full", pct >= 0 ? "bg-emerald/10 text-emerald" : "bg-rose/10 text-rose")}>
                           {fmtPct(pct, true)}
                         </div>
                       </div>
                       <div className="flex justify-between items-end">
                         <div>
                           <p className="text-[9px] text-muted font-bold uppercase">Resultado</p>
                           <p className={cn("text-sm font-black", profit >= 0 ? "text-emerald" : "text-rose")}>{fmt(profit, true)}</p>
                         </div>
                         <div className="text-right">
                           <p className="text-[9px] text-muted font-bold uppercase">Patrimônio</p>
                           <p className="text-sm font-black">{fmt(asset.marketValue)}</p>
                         </div>
                       </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Asset Categories Section (Always visible for now or filtered?) */}
        {subTab === 'RESUMO' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
               <h3 className="font-extrabold text-xl tracking-tight">Meus Ativos <span className="text-muted font-bold ml-1 text-sm">({stats.assetsCount})</span></h3>
            </div>

            <div className="space-y-3">
              {(Object.entries(categories) as [AssetCategory, typeof categories['STOCKS']][]).map(([type, meta]) => {
                const assets = grouped[type] || [];
                if (assets.length === 0) return null;
                
                const totalVal = assets.reduce((s, a) => s + a.marketValue, 0);
                const totalInv = assets.reduce((s, a) => s + a.invested, 0);
                const variation = assets.reduce((s, a) => s + a.dailyChange, 0);
                const rentability = totalInv > 0 ? ((totalVal - totalInv) / totalInv) * 100 : 0;
                const pctActual = (totalVal / (stats.marketValue || 1)) * 100;
                
                return (
                  <AccordionItem key={type} icon={meta.icon} label={meta.label} count={assets.length}>
                     <div className="grid grid-cols-2 md:grid-cols-5 gap-4 py-2">
                        <div className="flex flex-col">
                           <span className="text-[9px] uppercase font-bold text-muted tracking-widest mb-1">Ativos</span>
                           <span className="text-lg font-black">{assets.length}</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[9px] uppercase font-bold text-muted tracking-widest mb-1">Valor total</span>
                           <span className="text-lg font-black">{fmt(totalVal)}</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[9px] uppercase font-bold text-muted tracking-widest mb-1">Variação</span>
                           <div className={cn("flex items-center gap-1 font-bold", variation >= 0 ? "text-emerald" : "text-rose")}>
                              <span className="text-sm">{fmtPct((variation / totalVal) * 100, true)}</span>
                              {variation >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                           </div>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[9px] uppercase font-bold text-muted tracking-widest mb-1">Rentabilidade</span>
                           <div className={cn(
                             "flex items-center gap-1 px-2 py-0.5 rounded-full w-fit",
                             rentability >= 0 ? "bg-emerald/10 text-emerald" : "bg-rose/10 text-rose"
                           )}>
                              <span className="text-[10px] font-black">{fmtPct(rentability, true)}</span>
                              <ArrowUpRight size={10} />
                           </div>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[9px] uppercase font-bold text-muted tracking-widest mb-1">% na carteira</span>
                           <span className="text-xs font-bold text-muted">{pctActual.toFixed(0)}% / 10%</span>
                        </div>
                     </div>
                  </AccordionItem>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, subValue, subLabel, extraValue, extraLabel, pill, icon, variant, items, dualCol }: any) {
  if (dualCol) {
    return (
      <div className="bg-surface border border-border rounded-3xl p-6 flex flex-col justify-between h-40">
        <div className="grid grid-cols-2 h-full">
           {items.map((item: any, i: number) => (
             <div key={item.label} className={cn("flex flex-col justify-between", i === 0 && "border-r border-border pr-6", i === 1 && "pl-6")}>
                <div className="flex items-center gap-1.5 opacity-60">
                   <span className="text-[9px] uppercase font-bold tracking-widest">{item.label}</span>
                   <Info size={10} />
                </div>
                <div className="space-y-1">
                   <div className={cn("flex items-center gap-1 text-lg font-black tracking-tighter", item.trend ? "text-emerald" : "text-rose")}>
                      {item.value}
                      {item.trend ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                   </div>
                   {item.info && <p className="text-[10px] font-bold text-muted">{item.info}</p>}
                </div>
             </div>
           ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-3xl p-6 flex flex-col justify-between h-40 relative group overflow-hidden">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
           {icon}
           <h4 className="text-[9px] uppercase font-bold text-muted tracking-widest">{title}</h4>
        </div>
        {pill && (
          <span className="px-2 py-0.5 bg-sky/10 text-sky text-[10px] font-black rounded-full border border-sky/20">
            {pill}
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className={cn("text-2xl font-black tracking-tight", variant === 'profit' ? "text-emerald" : "text-text")}>{value}</p>
        <div className="flex items-center gap-4 mt-2">
           <div className="flex flex-col">
              <span className="text-[8px] uppercase font-bold text-muted tracking-tight">{subLabel}</span>
              <span className="text-[10px] font-black mono opacity-80">{subValue}</span>
           </div>
           {extraValue && (
             <div className="flex flex-col">
                <span className="text-[8px] uppercase font-bold text-muted tracking-tight">{extraLabel}</span>
                <span className="text-[10px] font-black mono opacity-80">{extraValue}</span>
             </div>
           )}
        </div>
      </div>
      
      {/* Decorative glow */}
      <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-sky/5 rounded-full blur-3xl group-hover:bg-sky/10 transition-colors"></div>
    </div>
  );
}

function AccordionItem({ icon: Icon, label, count, children }: any) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-sm hover:border-border2 transition-colors">
       <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-8 py-6 flex items-center justify-between group"
       >
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 rounded-xl bg-surface2 border border-border2 flex items-center justify-center text-muted group-hover:text-sky group-hover:scale-105 transition-all">
                <Icon size={20} />
             </div>
             <div className="text-left">
                <h4 className="font-extrabold text-lg tracking-tight">{label}</h4>
                <p className="text-[10px] font-bold text-muted tracking-widest uppercase">{count} ativos</p>
             </div>
          </div>
          <div className="flex items-center gap-8">
             {/* Preview metrics could go here */}
             <ChevronRight size={20} className={cn("text-muted transition-transform duration-300", isOpen ? "rotate-270" : "rotate-90")} />
          </div>
       </button>
       <AnimatePresence>
         {isOpen && (
           <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-8 pb-8"
           >
              <div className="h-px bg-border/40 mb-6 mx-[-2rem]"></div>
              {children}
           </motion.div>
         )}
       </AnimatePresence>
    </div>
  );
}

// ─── Component: PortfolioView ─────────────────────────────────────────────
function PortfolioView({ stats, fmt, fmtPct, onUpdateCategory }: any) {
  const [filter, setFilter] = useState<'ALL' | AssetCategory>('ALL');
  const [editingTicker, setEditingTicker] = useState<string | null>(null);

  const categories: Record<AssetCategory, { label: string; color: string }> = {
    STOCKS: { label: 'AÇÕES', color: '#bd1fff' },
    FII: { label: 'FII', color: '#4ade80' },
    FIXED: { label: 'RENDA FIXA', color: '#22c55e' },
    ETF: { label: 'ETF', color: '#38bdf8' },
    GOV: { label: 'TESOURO DIRETO', color: '#facc15' },
  };

  const grouped = stats.assets.reduce((acc: any, a: any) => {
    if (!acc[a.category]) acc[a.category] = { total: 0, invested: 0, count: 0, unrealized: 0 };
    acc[a.category].total += a.marketValue;
    acc[a.category].invested += a.invested;
    acc[a.category].count += 1;
    acc[a.category].unrealized += a.unrealized;
    return acc;
  }, {} as any);

  const filteredAssets = filter === 'ALL' 
    ? stats.assets 
    : stats.assets.filter((a: any) => a.category === filter);

  return (
    <div className="space-y-8">
      {/* Category Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(['ETF', 'STOCKS', 'FII'] as AssetCategory[]).map((cat) => {
          const data = grouped[cat] || { total: 0, invested: 0, count: 0, unrealized: 0 };
          const meta = categories[cat];
          const pct = data.invested > 0 ? (data.unrealized / data.invested) * 100 : 0;
          return (
            <div key={cat} className="bg-surface border border-border/50 rounded-3xl p-6 shadow-sm hover:border-sky/20 transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }}></div>
                  <span className="text-[10px] font-black tracking-widest text-muted uppercase">{meta.label}</span>
                </div>
                <span className="text-[10px] font-bold text-muted/60">{data.count} ativos</span>
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black tracking-tight">{fmt(data.total)}</h3>
                <div className="flex justify-between items-center">
                  <div className={cn("text-[10px] font-bold flex items-center gap-1", data.unrealized >= 0 ? "text-emerald" : "text-rose")}>
                    {fmt(data.unrealized, true)} ({fmtPct(pct, true)})
                  </div>
                  <span className="text-[9px] font-bold text-muted/60 uppercase tracking-tighter">
                    Custo {fmt(data.invested)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed Table Section */}
      <div className="bg-surface border border-border/50 rounded-3xl shadow-sm">
        <div className="p-8 border-b border-border/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
           <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-sky shadow-[0_0_8px_rgba(56,189,248,0.4)]"></div>
              <h3 className="font-extrabold text-lg tracking-tight">Carteira detalhada</h3>
           </div>

           <div className="flex items-center p-1 bg-surface2/50 border border-border rounded-xl">
             <button 
              onClick={() => setFilter('ALL')}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[10px] font-black transition-all",
                filter === 'ALL' ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text"
              )}
             >
               Todos ({stats.assetsCount})
             </button>
             {Object.entries(categories).map(([key, meta]) => {
               const count = grouped[key]?.count || 0;
               if (count === 0) return null;
               return (
                 <button 
                  key={key}
                  onClick={() => setFilter(key as AssetCategory)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[10px] font-black transition-all",
                    filter === key ? "bg-sky text-white shadow-sm" : "text-muted hover:text-text"
                  )}
                 >
                   {meta.label} ({count})
                 </button>
               );
             })}
           </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface2/30">
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest">Ativo</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-center">Classe</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Qtd.</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">P. Médio</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Atual</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Patrimônio</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Lucro/Prej.</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Rent.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {filteredAssets.map((a: Asset) => (
                <tr key={a.ticker} className="hover:bg-surface2/20 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-surface2 border border-border2 flex items-center justify-center font-bold text-[10px] mono text-sky group-hover:scale-105 transition-transform">
                        {a.ticker.slice(0, 3)}
                      </div>
                      <div>
                        <p className="font-extrabold text-sm mono leading-none mb-1">{a.ticker}</p>
                        <p className="text-[10px] font-bold text-muted truncate max-w-[140px] uppercase tracking-tighter">{a.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex justify-center relative">
                      <button 
                        onClick={() => setEditingTicker(editingTicker === a.ticker ? null : a.ticker)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-black text-[10px] uppercase tracking-tighter transition-all hover:scale-105 active:scale-95"
                        style={{ 
                          borderColor: `${categories[a.category]?.color || '#333'}40`, 
                          color: categories[a.category]?.color || '#fff',
                          backgroundColor: `${categories[a.category]?.color || '#333'}10`
                        }}
                      >
                        {categories[a.category]?.label || a.category}
                        <ChevronDown size={10} className={cn("transition-transform", editingTicker === a.ticker && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {editingTicker === a.ticker && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute z-50 top-full mt-2 bg-surface border border-border rounded-2xl shadow-2xl p-2 min-w-[160px]"
                          >
                            {Object.entries(categories).map(([key, meta]) => (
                              <button
                                key={key}
                                onClick={() => {
                                  onUpdateCategory(a.ticker, key as AssetCategory);
                                  setEditingTicker(null);
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all hover:bg-surface2",
                                  a.category === key ? "text-sky bg-sky/5" : "text-muted"
                                )}
                              >
                                {meta.label}
                                {a.category === key && <div className="w-1.5 h-1.5 rounded-full bg-sky" />}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right mono text-sm font-bold">{a.qty.toLocaleString()}</td>
                  <td className="px-8 py-5 text-right mono text-sm text-muted">{fmt(a.avgPrice)}</td>
                  <td className="px-8 py-5 text-right">
                    <p className={cn("mono text-sm font-black", a.isLive && "text-sky")}>{fmt(a.currentPrice)}</p>
                    <p className={cn("text-[9px] font-black uppercase", a.dailyChange >= 0 ? "text-emerald" : "text-rose")}>
                      {fmtPct(a.changePct, true)}
                    </p>
                  </td>
                  <td className="px-8 py-5 text-right mono text-sm font-black text-text">{fmt(a.marketValue)}</td>
                  <td className={cn("px-8 py-5 text-right mono text-sm font-black", a.unrealized >= 0 ? "text-emerald" : "text-rose")}>
                    {fmt(a.unrealized, true)}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className={cn(
                      "inline-flex items-center gap-1 px-3 py-1 rounded-full font-black text-[10px]",
                      a.unrealized >= 0 ? "bg-emerald/10 text-emerald" : "bg-rose/10 text-rose"
                    )}>
                      {fmtPct((a.unrealized / a.invested) * 100, true)}
                      <ArrowUpRight size={10} strokeWidth={3} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ─── Component: TransactionsHistory ───────────────────────────────────────
function TransactionsHistory({ transactions, setTransactions, fmt, addToast, onEdit, onImportSuccess, currency, usdbrl }: any) {
  const formatTxValue = (val: number, ticker: string) => {
    const isBRLAsset = ticker.endsWith('.SA');
    // If we are in the same currency as the asset, just return the value
    if ((currency === 'BRL' && isBRLAsset) || (currency === 'USD' && !isBRLAsset)) {
      const symbol = isBRLAsset ? 'R$' : '$';
      return symbol + ' ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    
    // Otherwise, normalize to USD and then use fmt
    const toUSDRate = isBRLAsset ? (1 / usdbrl) : 1;
    return fmt(val * toUSDRate);
  };

  const [ticker, setTicker] = useState('');
  const [type, setType] = useState<TransactionType>('BUY');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [tax, setTax] = useState('0');

  const [tickerFilter, setTickerFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const tickers = Array.from(new Set(transactions.map((t: any) => t.ticker))) as string[];

  const filtered = transactions.filter((t: any) => {
    const matchTicker = tickerFilter === 'ALL' || t.ticker === tickerFilter;
    const matchType = typeFilter === 'ALL' || t.type === typeFilter;
    return matchTicker && matchType;
  }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(qty);
    const p = parseFloat(price);
    const t = parseFloat(tax);
    if (isNaN(q) || isNaN(p) || !ticker) return;

    const newTx: Transaction = {
      id: `T-${Date.now()}`,
      ticker: ticker.toUpperCase(),
      type,
      date,
      quantity: q,
      price: p,
      fee: t,
      total: q * p
    };

    setTransactions((prev: Transaction[]) => [...prev, newTx]);
    addToast('Lançamento realizado com sucesso');
    
    // Reset form
    setTicker('');
    setQty('');
    setPrice('');
    setTax('0');
  };

  const exportCSV = () => {
    const headers = ['Data', 'Tipo', 'Ticker', 'Quantidade', 'Preço', 'Taxa', 'Total'];
    const rows = transactions.map((t: Transaction) => [t.date, t.type, t.ticker, t.quantity, t.price, t.fee, t.total]);
    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `portfolio_global_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(transactions, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `portfolio_global_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importB3 = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = read(data, { type: 'array' });
          const firstSheetNames = workbook.SheetNames;
          let allNormalized: Transaction[] = [];

          firstSheetNames.forEach(name => {
            const sheet = workbook.Sheets[name];
            const rows = utils.sheet_to_json(sheet) as any[];
            
            const normalized = rows.map((row: any) => {
              const dateStr = row['Data do Negócio'] || row['Data'] || '';
              let date = '';
              if (dateStr) {
                 if (typeof dateStr === 'string' && dateStr.includes('/')) {
                    const parts = dateStr.split('/');
                    if (parts.length === 3) date = `${parts[2]}-${parts[1]}-${parts[0]}`;
                 } else if (typeof dateStr === 'number') {
                    // Handle Excel dates if they come through as numbers
                    const dateObj = new Date((dateStr - 25569) * 86400 * 1000);
                    date = dateObj.toISOString().split('T')[0];
                 } else {
                    date = dateStr;
                 }
              }

              let ticker = (row['Código de Negociação'] || row['Produto'] || row['Ativo'] || '').split(' ')[0].toUpperCase();
              if (ticker && /^[A-Z]{4}[0-9]{1,2}$/.test(ticker) && !ticker.endsWith('.SA')) {
                ticker += '.SA';
              }

              const typeRaw = (row['Tipo de Movimentação'] || row['Movimentação'] || '').toUpperCase();
              const type: TransactionType = (typeRaw.includes('VENDA') || typeRaw === 'SELL' || typeRaw.includes('RESGATE')) ? 'SELL' : 'BUY';

              const quantity = parseFloat(row['Quantidade'] || row['Qtd'] || 0);
              const price = parseFloat(row['Preço (R$)'] || row['Preço Unitário'] || row['Preço'] || 0);
              const total = parseFloat(row['Valor Total (R$)'] || row['Operação (R$)'] || row['Total'] || (quantity * price));
              
              return {
                id: `T-${Math.random().toString(36).substr(2, 9)}`,
                ticker,
                type,
                date: date || new Date().toISOString().split('T')[0],
                quantity,
                price,
                fee: 0,
                total
              };
            }).filter(t => t.ticker && t.quantity > 0);
            
            allNormalized = [...allNormalized, ...normalized];
          });

          if (allNormalized.length === 0) {
             addToast('Nenhuma transação válida encontrada no arquivo B3', 'warning');
             return;
          }

          setTransactions((prev: Transaction[]) => {
             const existingKeys = new Set(prev.map(t => `${t.ticker}-${t.date}-${t.quantity}-${t.type}`));
             const uniqueNew = allNormalized.filter(t => !existingKeys.has(`${t.ticker}-${t.date}-${t.quantity}-${t.type}`));
             return [...prev, ...uniqueNew];
          });
          
          addToast(`${allNormalized.length} lançamentos importados da B3!`, 'success');
          if (onImportSuccess) onImportSuccess();
        } catch (err) {
          addToast('Erro ao processar arquivo B3. Verifique se é o XLSX do Portal do Investidor.', 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const importJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target?.result as string);
          if (Array.isArray(json)) {
            // Normalização dos dados importados
            const normalized = json.map((t: any) => {
              const qty = parseFloat(t.quantity || t.qty || 0);
              const price = parseFloat(t.price || 0);
              const fee = parseFloat(t.fee || t.tax || 0);
              return {
                id: t.id || `T-${Math.random().toString(36).substr(2, 9)}`,
                ticker: (t.ticker || '').toUpperCase(),
                type: (t.type === 'SELL' || t.type === 'Venda') ? 'SELL' : 'BUY',
                date: t.date || new Date().toISOString().split('T')[0],
                quantity: qty,
                price: price,
                fee: fee,
                total: t.total || (qty * price)
              };
            }).filter(t => t.ticker && t.quantity > 0);

            setTransactions(normalized);
            addToast('Dados importados e normalizados com sucesso!');
            if (onImportSuccess) onImportSuccess();
          }
        } catch (err) {
          addToast('Erro ao importar arquivo JSON', 'error');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="space-y-8">
      {/* Seção Novo Lançamento */}
      <div className="bg-surface border border-border rounded-3xl p-8 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
             <span className="w-2.5 h-2.5 rounded-full bg-sky animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.6)]"></span>
             <h3 className="font-extrabold text-xl tracking-tight">Novo lançamento</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface2 border border-border2 text-[10px] font-bold hover:bg-surface3 transition-all">
              <FileText size={14} className="text-muted" />
              CSV
            </button>
            <button onClick={exportJSON} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface2 border border-border2 text-[10px] font-bold hover:bg-surface3 transition-all">
              <FileJson size={14} className="text-muted" />
              JSON
            </button>
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald/10 border border-emerald/30 text-[10px] text-emerald font-black hover:bg-emerald/20 transition-all cursor-pointer">
              <Library size={14} />
              Importar B3
              <input type="file" accept=".xlsx,.xls,.csv" onChange={importB3} className="hidden" />
            </label>
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface2 border border-border2 text-[10px] font-bold hover:bg-surface3 transition-all cursor-pointer">
              <Upload size={14} className="text-muted" />
              Importar JSON
              <input type="file" accept=".json" onChange={importJSON} className="hidden" />
            </label>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Ticker</label>
               <input 
                 type="text" 
                 value={ticker}
                 onChange={e => setTicker(e.target.value.toUpperCase())}
                 placeholder="AAPL, FWRA.L..."
                 className="bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all mono"
               />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Tipo</label>
               <div className="relative">
                 <select 
                   value={type}
                   onChange={e => setType(e.target.value as any)}
                   className="w-full appearance-none bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all cursor-pointer"
                 >
                   <option value="BUY">Compra</option>
                   <option value="SELL">Venda</option>
                 </select>
                 <ChevronRight size={16} className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none text-muted" />
               </div>
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Quantidade</label>
               <input 
                 type="number" 
                 step="any"
                 value={qty}
                 onChange={e => setQty(e.target.value)}
                 className="bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all mono"
               />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Preço Unitário.</label>
               <input 
                 type="number" 
                 step="any"
                 value={price}
                 onChange={e => setPrice(e.target.value)}
                 className="bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all mono"
               />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Impostos</label>
               <input 
                 type="number" 
                 step="any"
                 value={tax}
                 onChange={e => setTax(e.target.value)}
                 className="bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all mono"
               />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-1 flex flex-col gap-2">
               <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Dados</label>
               <div className="relative">
                 <input 
                   type="date" 
                   value={date}
                   onChange={e => setDate(e.target.value)}
                   className="w-full bg-surface2 border border-border2 rounded-2xl px-4 py-4 text-sm focus:border-sky outline-hidden transition-all pr-12"
                 />
                 <History size={18} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
               </div>
            </div>
            <div className="md:col-span-3">
              <button 
                type="submit"
                className="w-full bg-linear-to-r from-[#00c6ff] to-[#bd1fff] text-white font-black py-4 rounded-2xl text-sm transition-all hover:scale-[1.01] active:scale-[0.99] shadow-[0_10px_20px_rgba(189,31,255,0.2)] flex items-center justify-center gap-2"
              >
                <Plus size={20} strokeWidth={3} />
                lançamento
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Histórico */}
      <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-sm">
        <div className="p-8 border-b border-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
             <span className="w-2.5 h-2.5 rounded-full bg-sky shadow-[0_0_8px_rgba(56,189,248,0.4)]"></span>
             <h3 className="font-extrabold text-xl tracking-tight">Histórico ( {transactions.length} )</h3>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-bold text-muted">
               <Filter size={14} />
               Filtrar:
            </div>
            <div className="flex gap-2">
               <div className="relative">
                 <select 
                   value={tickerFilter}
                   onChange={e => setTickerFilter(e.target.value)}
                   className="appearance-none bg-surface2 border border-border2 rounded-xl py-2 pl-4 pr-10 text-[10px] font-bold focus:border-sky outline-hidden cursor-pointer"
                 >
                   <option value="ALL">Todos os tickers</option>
                   {tickers.map(t => <option key={t} value={t}>{t}</option>)}
                 </select>
                 <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none text-muted" />
               </div>

               <div className="relative">
                 <select 
                   value={typeFilter}
                   onChange={e => setTypeFilter(e.target.value)}
                   className="appearance-none bg-surface2 border border-border2 rounded-xl py-2 pl-4 pr-10 text-[10px] font-bold focus:border-sky outline-hidden cursor-pointer"
                 >
                   <option value="ALL">Compra e Venda</option>
                   <option value="BUY">Apenas Compras</option>
                   <option value="SELL">Apenas Vendas</option>
                 </select>
                 <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none text-muted" />
               </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface2/30">
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest">Data</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest">Tipo</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-center">Ativo</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Qtd.</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Preço</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Taxa</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Total</th>
                <th className="px-8 py-5 text-[10px] uppercase font-bold text-muted tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {filtered.map((tx: Transaction) => (
                <tr key={tx.id} className="hover:bg-surface2/20 transition-colors group">
                  <td className="px-8 py-5 text-xs font-semibold text-muted">{tx.date}</td>
                  <td className="px-8 py-5">
                    <span className={cn(
                      "px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter",
                      tx.type === 'BUY' ? "bg-emerald/10 text-emerald border border-emerald/20" : "bg-rose/10 text-rose border border-rose/20"
                    )}>
                      {tx.type === 'BUY' ? 'Compra' : 'Venda'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-center font-black mono text-sm text-sky">{tx.ticker}</td>
                  <td className="px-8 py-5 text-right mono text-sm">{tx.quantity.toLocaleString()}</td>
                  <td className="px-8 py-5 text-right mono text-sm font-bold">{formatTxValue(tx.price, tx.ticker)}</td>
                  <td className="px-8 py-5 text-right mono text-sm text-muted">{formatTxValue(tx.fee || 0, tx.ticker)}</td>
                  <td className="px-8 py-5 text-right mono text-sm font-black">{formatTxValue(tx.total, tx.ticker)}</td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => onEdit(tx)} className="p-2 text-muted hover:text-sky hover:bg-sky/10 rounded-lg transition-all"><Edit2 size={14} /></button>
                      <button 
                        onClick={() => {
                          setTransactions((prev: any) => prev.filter((t: any) => t.id !== tx.id));
                          addToast('Lançamento removido');
                        }} 
                        className="p-2 text-muted hover:text-rose hover:bg-rose/10 rounded-lg transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-8 py-20 text-center">
                     <div className="flex flex-col items-center gap-2 opacity-30">
                        <History size={40} />
                        <p className="text-sm font-bold">Nenhuma operação encontrada</p>
                     </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StrategyTab({ stats, metas, setMetas, fmt, fmtPct }: any) {
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const totalMV = stats.marketValue || 1;
  const currentAllocation = stats.assets.map(a => ({
    ...a,
    pct: (a.marketValue / totalMV) * 100,
    target: metas[a.ticker] || 0
  }));

  const handleSaveMeta = (ticker: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      setMetas((prev: any) => ({ ...prev, [ticker]: val }));
    }
    setEditingTicker(null);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <Target className="text-sky" size={18} />
          Alocação Alvo (Target)
        </h3>
        <p className="text-sm text-muted mb-8">Defina o percentual desejado para cada ativo. O dashboard ajudará no rebalanceamento.</p>
        
        <div className="space-y-8">
          {currentAllocation.map(a => (
            <div key={a.ticker} className="group">
              <div className="flex justify-between items-end mb-2">
                <div className="flex items-center gap-3">
                  <p className="font-bold mono">{a.ticker}</p>
                  {editingTicker === a.ticker ? (
                    <div className="flex gap-2">
                      <input 
                        autoFocus
                        type="number" 
                        value={editValue} 
                        onChange={e => setEditValue(e.target.value)} 
                        className="w-20 bg-surface2 border border-sky border-2 rounded-lg px-2 py-1 text-xs outline-hidden"
                      />
                      <button onClick={() => handleSaveMeta(a.ticker)} className="text-emerald hover:scale-110 transition-all"><CheckCircle2 size={18} /></button>
                      <button onClick={() => setEditingTicker(null)} className="text-muted"><X size={18} /></button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => { setEditingTicker(a.ticker); setEditValue(a.target.toString()); }}
                      className="text-xs text-muted hover:text-sky flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Settings size={12} />
                      {a.target > 0 ? `${a.target}% meta` : "Sem meta"}
                    </button>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold">{a.pct.toFixed(1)}% / {a.target}%</p>
                </div>
              </div>
              <div className="h-4 w-full bg-surface3 rounded-full relative">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${a.pct}%` }}
                  className="h-full rounded-full absolute top-0 left-0 z-10"
                  style={{ backgroundColor: a.color }}
                ></motion.div>
                {a.target > 0 && (
                  <div 
                    className="h-6 w-1 bg-text absolute top-1/2 -translate-y-1/2 z-20 shadow-lg"
                    style={{ left: `${a.target}%`, pointerEvents: 'none' }}
                  ></div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="font-bold mb-6">Sugestão de Rebalanceamento</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-muted text-[10px] font-bold uppercase tracking-widest border-b border-border">
                <th className="pb-4">Ativo</th>
                <th className="pb-4 text-right">Diferença</th>
                <th className="pb-4 text-right">Ação</th>
                <th className="pb-4 text-right">Valor Estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {currentAllocation.filter(a => a.target > 0).map(a => {
                const diff = (a.target / 100 * stats.marketValue) - a.marketValue;
                return (
                  <tr key={a.ticker}>
                    <td className="py-4 font-bold mono">{a.ticker}</td>
                    <td className="py-4 text-right">
                      <span className={cn("px-2 py-1 rounded text-[10px] font-bold", (a.pct - a.target) > 0 ? "bg-amber/10 text-amber" : "bg-sky/10 text-sky")}>
                        {((a.pct - a.target) >= 0 ? '+' : '') + (a.pct - a.target).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-4 text-right font-medium text-xs uppercase">{diff >= 0 ? 'Aportar' : 'Excedido'}</td>
                    <td className="py-4 text-right font-bold mono">{fmt(Math.abs(diff))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface border border-border2 rounded-2xl p-8">
           <div className="flex items-center gap-3 mb-6">
              <span className="w-2 h-2 rounded-full bg-sky"></span>
              <h3 className="font-bold text-lg">Perguntas frequentes</h3>
           </div>
           
           <div className="space-y-6">
              <div>
                 <p className="font-bold text-sm text-text mb-1">Como adiciono um ativo?</p>
                 <p className="text-xs text-muted leading-relaxed">Vá em Lançamentos e cadastre uma compra com o ticker (ex.: AAPL, PETR4.SA, FWRA.L), quantidade, preço e dados. A carteira recalcula automaticamente.</p>
              </div>

              <div>
                 <p className="font-bold text-sm text-text mb-1">De onde os preços?</p>
                 <p className="text-xs text-muted leading-relaxed">Cotações ao vivo do Yahoo Finance, atualizadas a cada minuto enquanto a página está aberta.</p>
              </div>

              <div>
                 <p className="font-bold text-sm text-text mb-1">Como vendo um ativo?</p>
                 <p className="text-xs text-muted leading-relaxed">Em Lançamentos, escolha tipo 'Venda'. O lucro realizado entra automaticamente no total e a posição é reduzida usando preço médio.</p>
              </div>

              <div>
                 <p className="font-bold text-sm text-text mb-1">Onde meus dados ficam salvas?</p>
                 <p className="text-xs text-muted leading-relaxed">Localmente no seu navegador (localStorage). Limpar o site removerá os lançamentos.</p>
              </div>
           </div>
        </div>

        <div className="bg-surface border border-border2 rounded-2xl p-8">
           <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 rounded-full bg-sky"></span>
              <h3 className="font-bold text-lg">Sufixos de Ticker</h3>
           </div>
           <p className="text-xs text-muted mb-8">Use o sufixo correto para identificar a bolsa do ativo no Yahoo Finance.</p>
           
           <div className="overflow-x-auto">
              <table className="w-full text-xs">
                 <thead>
                    <tr className="text-muted font-bold text-[10px] uppercase tracking-wider">
                       <th className="pb-4 text-left">Sufixo</th>
                       <th className="pb-4 text-left">Bolsa</th>
                       <th className="pb-4 text-right">Exemplo</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-border/10">
                    <tr>
                       <td className="py-3 font-bold mono">.SA</td>
                       <td className="py-3 text-muted">B3 — Brasil</td>
                       <td className="py-3 text-right text-sky mono">PETR4.SA</td>
                    </tr>
                    <tr>
                       <td className="py-3 font-bold mono">.L</td>
                       <td className="py-3 text-muted">Bolsa de Valores de Londres</td>
                       <td className="py-3 text-right text-sky mono">FWRA.L</td>
                    </tr>
                    <tr>
                       <td className="py-3 font-bold mono">.DE</td>
                       <td className="py-3 text-muted">XETRA — Alemanha</td>
                       <td className="py-3 text-right text-sky mono">VWCE.DE</td>
                    </tr>
                    <tr>
                       <td className="py-3 font-bold mono">.PA</td>
                       <td className="py-3 text-muted">Euronext Paris</td>
                       <td className="py-3 text-right text-sky mono">MC.PA</td>
                    </tr>
                    <tr>
                       <td className="py-3 font-bold mono">.HK</td>
                       <td className="py-3 text-muted">Hong Kong</td>
                       <td className="py-3 text-right text-sky mono">0700.HK</td>
                    </tr>
                    <tr>
                       <td className="py-3 font-bold mono">(sem)</td>
                       <td className="py-3 text-muted">NASDAQ / NYSE — EUA</td>
                       <td className="py-3 text-right text-sky mono">AAPL</td>
                    </tr>
                 </tbody>
              </table>
           </div>
        </div>
      </div>
    </div>
  );
}

function DividendsView({ dividends, onSync, isRefreshing, fmt, currency, usdbrl, transactions }: { 
  dividends: Dividend[]; 
  onSync: () => void; 
  isRefreshing: boolean;
  fmt: any;
  currency: string;
  usdbrl: number;
  transactions: Transaction[];
}) {
  const [viewType, setViewType] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [range, setRange] = useState(12);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Group by year for the heatmap table
  const yearlyHistory = useMemo(() => {
    const history: Record<number, Record<number, number>> = {};
    const years = new Set<number>();
    
    dividends.forEach(div => {
      const d = new Date(div.date);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-11
      const isDivBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
      const rate = isDivBRL ? (1 / usdbrl) : 1;
      const value = div.total * rate;

      if (!history[year]) history[year] = {};
      history[year][month] = (history[year][month] || 0) + value;
      years.add(year);
    });

    return {
      data: history,
      years: Array.from(years).sort((a, b) => b - a)
    };
  }, [dividends, usdbrl]);

  const rangeData = useMemo(() => {
    const received: Record<string, number> = {};
    const toReceive: Record<string, number> = {};
    const now = new Date();
    
    if (viewType === 'MONTHLY') {
      for (let i = 0; i < range; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - (range - 1 - i), 1);
          const key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
          received[key] = 0;
          toReceive[key] = 0;
      }
    } else {
      // Annual view: group by year for last 5 years
      const currentYear = now.getFullYear();
      for (let i = 4; i >= 0; i--) {
        const year = (currentYear - i).toString();
        received[year] = 0;
        toReceive[year] = 0;
      }
    }

    dividends.forEach(div => {
      const d = new Date(div.date);
      let key = '';
      if (viewType === 'MONTHLY') {
        key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
      } else {
        key = d.getFullYear().toString();
      }

      if (received[key] !== undefined) {
        const isDivBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
        const rate = isDivBRL ? (1 / usdbrl) : 1;
        if (d <= now) {
          received[key] += div.total * rate;
        } else {
          toReceive[key] += div.total * rate;
        }
      }
    });

    return { received, toReceive };
  }, [dividends, range, viewType, usdbrl]);

  const labels = Object.keys(rangeData.received);
  const receivedValues = Object.values(rangeData.received);
  const toReceiveValues = Object.values(rangeData.toReceive);

  const totalRange = useMemo(() => {
      return receivedValues.reduce((a: number, b: number) => a + b, 0);
  }, [receivedValues]);

  const avgMonthly = totalRange / (viewType === 'ANNUAL' ? (labels.length * 12) : range);

  const assetDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    dividends.forEach(div => {
       // Normalize to USD
       const isDivBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
       const rate = isDivBRL ? (1 / usdbrl) : 1;
       dist[div.ticker] = (dist[div.ticker] || 0) + (div.total * rate);
    });
    return Object.entries(dist)
      .map(([ticker, value]) => ({ ticker, value }))
      .sort((a, b) => b.value - a.value);
  }, [dividends, usdbrl]);

  const { totalAllTime, totalPredicted } = useMemo(() => {
    let received = 0;
    let predicted = 0;
    const now = new Date();
    
    dividends.forEach(div => {
       // Normalize to USD
       const isDivBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
       const rate = isDivBRL ? (1 / usdbrl) : 1;
       const value = div.total * rate;
       if (new Date(div.date) <= now) {
         received += value;
       } else {
         predicted += value;
       }
    });
    return { totalAllTime: received, totalPredicted: predicted };
  }, [dividends, usdbrl]);

  // Chart data
  const chartData = {
    labels,
    datasets: [
      {
        label: 'Proventos recebidos',
        data: receivedValues,
        backgroundColor: 'rgba(56, 189, 248, 0.8)',
        borderRadius: 4,
        barThickness: 24,
      },
      {
        label: 'Proventos a receber',
        data: toReceiveValues,
        backgroundColor: 'rgba(56, 189, 248, 0.25)',
        borderRadius: 4,
        barThickness: 24,
      }
    ]
  };

  const donutData = {
    labels: assetDistribution.slice(0, 5).map(a => a.ticker),
    datasets: [{
      data: assetDistribution.slice(0, 5).map(a => a.value),
      backgroundColor: COLORS,
      borderWidth: 2,
      borderColor: 'transparent',
      hoverBorderColor: 'transparent',
      cutout: '80%'
    }]
  };

  const sortedDividends = useMemo(() => 
    [...dividends].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), 
    [dividends]
  );

  // Target calculation (mock for UI)
  const targetMonthly = 1000; // Example target
  const progress = Math.min((avgMonthly / targetMonthly) * 100, 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            Proventos
            {isRefreshing && <RefreshCw size={16} className="text-sky animate-spin" />}
          </h2>
          <p className="text-xs text-muted font-bold uppercase tracking-widest mt-1">Gestão e Evolução de Dividendos</p>
        </div>
        <button 
          onClick={onSync}
          disabled={isRefreshing}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-sky text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-sky/90 transition-all shadow-lg shadow-sky/20 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
          Sincronizar Prov.
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Resumo */}
        <div className="w-full lg:w-1/3 flex flex-col gap-6">
          <div className="bg-surface border border-border2 rounded-3xl p-6 shadow-xs h-full flex flex-col">
            <h3 className="text-sm font-bold mb-6">Resumo</h3>
            
            <div className="space-y-6 grow">
              <div>
                <div className="flex justify-between items-end mb-1">
                   <p className="text-[10px] font-bold text-muted uppercase tracking-widest">Média Mensal (últ. {range} meses)</p>
                   <span className="text-[10px] font-bold text-muted">{progress.toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-2">
                   <h4 className="text-xl font-black">{fmt(avgMonthly)}</h4>
                   <button className="text-[9px] font-bold text-sky hover:underline">/ Criar meta ↗</button>
                </div>
                <div className="h-1 bg-surface2 rounded-full mt-3 overflow-hidden">
                   <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-sky" 
                   />
                </div>
              </div>

              <div className="pt-6 border-t border-border2/50">
                 <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-muted uppercase tracking-widest">
                   <span>Total no Período</span>
                   <Info size={10} className="text-muted/50" />
                 </div>
                 <h4 className="text-xl font-black">{fmt(totalRange)}</h4>
              </div>

              <div className="pt-6 border-t border-border2/50">
                 <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Total Recebido (Histórico)</p>
                 <h4 className="text-xl font-black text-emerald">{fmt(totalAllTime)}</h4>
              </div>

              {totalPredicted > 0 && (
                <div className="pt-6 border-t border-border2/50">
                   <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Total a Receber (Previsto)</p>
                   <h4 className="text-xl font-black text-sky">{fmt(totalPredicted)}</h4>
                </div>
              )}

              <div className="pt-6 border-t border-border2/50">
                 <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-6">Distribuição de proventos (Período)</p>
                 <div className="flex flex-col items-center">
                    <div className="w-40 h-40 relative">
                       <Doughnut data={donutData as any} options={{ 
                         plugins: { legend: { display: false }, tooltip: { enabled: true } }, 
                         maintainAspectRatio: false 
                       }} />
                       <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                          <span className="text-[8px] font-bold text-muted uppercase tracking-wider">Top 5</span>
                          <span className="text-xs font-black">Ativos</span>
                       </div>
                    </div>
                    
                    <div className="w-full mt-6 space-y-3">
                       {assetDistribution.slice(0, 3).map((asset, i) => (
                         <div key={asset.ticker} className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-2">
                               <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                               <span className="font-bold text-muted">{asset.ticker}</span>
                            </div>
                            <span className="font-black text-text">
                               {totalRange > 0 ? ((asset.value / totalRange) * 100).toFixed(2) : '0.00'}%
                            </span>
                         </div>
                       ))}
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="w-full lg:w-2/3">
          <div className="bg-surface border border-border2 rounded-3xl p-6 shadow-xs h-full flex flex-col">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
              <h3 className="text-lg font-bold">Evolução de Proventos</h3>
              
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-surface2 p-1 rounded-xl border border-border2">
                  <button 
                    onClick={() => setViewType('MONTHLY')}
                    className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all", viewType === 'MONTHLY' ? "bg-surface shadow-xs text-text" : "text-muted hover:text-text")}
                  >
                    Mensal
                  </button>
                  <button 
                    onClick={() => setViewType('ANNUAL')}
                    className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all", viewType === 'ANNUAL' ? "bg-surface shadow-xs text-text" : "text-muted hover:text-text")}
                  >
                    Anual
                  </button>
                </div>

                <select 
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                  className="bg-surface2 border border-border2 rounded-xl px-3 py-1.5 text-[10px] font-bold text-text focus:border-sky outline-hidden cursor-pointer"
                >
                  <option value={6}>Últimos 6 meses</option>
                  <option value={12}>Últimos 12 meses</option>
                  <option value={24}>Últimos 24 meses</option>
                </select>

                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-border2 rounded-xl text-[10px] font-bold text-muted cursor-pointer hover:border-muted/50 transition-all">
                   <Building2 size={12} />
                   <span>Tipo de ativo</span>
                   <ChevronDown size={12} />
                </div>

                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-border2 rounded-xl text-[10px] font-bold text-muted cursor-pointer hover:border-muted/50 transition-all">
                   <Percent size={12} />
                   <span>Ativos</span>
                   <ChevronDown size={12} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 mb-8 text-[10px] font-bold">
               <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-sky/80" />
                  <span className="text-muted">Proventos recebidos</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-sky/30" />
                  <span className="text-muted">Proventos a receber</span>
                  <Info size={10} className="text-muted/50" />
               </div>
            </div>

            <div className="grow min-h-[440px]">
               <Bar 
                 data={chartData} 
                 options={{
                   responsive: true,
                   maintainAspectRatio: false,
                   onClick: (_evt: any, elements: any[]) => {
                     if (elements.length > 0) {
                       const index = elements[0].index;
                       const label = labels[index];
                       setSelectedPeriod(label);
                       setShowDetail(true);
                     }
                   },
                   plugins: {
                     legend: { display: false },
                     tooltip: {
                        backgroundColor: '#1e293b',
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 12 },
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                           label: (context) => {
                             const dsIndex = context.datasetIndex;
                             const label = dsIndex === 0 ? 'Recebido' : 'A receber';
                             return `${label}: ${fmt(context.raw as number)}`;
                           }
                        }
                     }
                   },
                   scales: {
                     x: { 
                       stacked: true,
                       grid: { display: false }, 
                       ticks: { font: { size: 10, weight: '600' }, color: '#64748b' },
                       border: { display: false }
                     },
                     y: { 
                       stacked: true,
                       grid: { color: 'rgba(148, 163, 184, 0.05)' }, 
                       ticks: { 
                         font: { size: 10, weight: '600' }, 
                         color: '#64748b',
                         callback: (val) => fmt(val as number).replace('$', '').replace('R$', '').trim()
                       },
                       border: { display: false }
                     }
                   }
                 } as any}
               />
            </div>
          </div>
        </div>
      </div>

      {/* History Heatmap Table (Investidor 10 Style) */}
      <div className="bg-surface border border-border2 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-6 border-b border-border2/50 flex justify-between items-center">
            <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
              <Calendar size={16} className="text-sky" />
              Histórico Mensal
            </h3>
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald/10 text-emerald rounded-full text-[10px] font-black uppercase">
               Total {fmt(totalAllTime)}
            </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border2/30">
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">Ano</th>
                {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map(m => (
                  <th key={m} className="px-3 py-4 text-[10px] font-bold text-muted uppercase tracking-widest text-center">{m}</th>
                ))}
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest text-right whitespace-nowrap">Média</th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest text-right whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border2/10">
              {yearlyHistory.years.map(year => {
                const yearData = yearlyHistory.data[year];
                let yearTotal = 0;
                let activeMonths = 0;
                return (
                  <tr key={year} className="hover:bg-surface2/30 transition-colors">
                    <td className="px-6 py-4 text-xs font-black text-text">{year}</td>
                    {[0,1,2,3,4,5,6,7,8,9,10,11].map(month => {
                      const val = yearData[month] || 0;
                      yearTotal += val;
                      if (val > 0) activeMonths++;
                      return (
                        <td key={month} className="px-3 py-4 text-center">
                          <span className={cn("text-[11px] font-bold mono", val > 0 ? "text-text" : "text-muted/30")}>
                            {val > 0 ? fmt(val).replace('R$', '').replace('$', '').trim() : '0,00'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-6 py-4 text-right">
                       <span className="text-[11px] font-bold text-muted mono">
                         {fmt(yearTotal / 12).replace('R$', '').replace('$', '').trim()}
                       </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                       <span className="text-xs font-black text-emerald mono">
                         {fmt(yearTotal).replace('R$', '').replace('$', '').trim()}
                       </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Dividends List */}
      <div className="bg-surface border border-border2 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-6 border-b border-border2/50 flex justify-between items-center">
          <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
            <History size={16} className="text-sky" />
            Extrato Detalhado de Proventos
          </h3>
          <span className="text-[10px] font-bold text-muted uppercase">{dividends.length} Lançamentos</span>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b border-border2/30 text-left">
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">Ativo</th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">Data</th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">Valor/Ação</th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest text-right">Total Bruto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border2/10">
              {sortedDividends.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted text-xs italic font-medium">
                    Nenhum provento sincronizado.
                  </td>
                </tr>
              ) : (
                sortedDividends.map((div, i) => {
                  const isFuture = new Date(div.date) > new Date();
                  return (
                    <tr key={div.id} className={cn("hover:bg-surface2/50 transition-colors", i % 2 === 1 && "bg-surface2/20", isFuture && "opacity-60")}>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-sky mono uppercase">{div.ticker}</span>
                          <span className="text-[9px] text-muted font-bold">{div.quantity.toLocaleString()} cota(s)</span>
                        </div>
                        {isFuture && <span className="mt-1 inline-block text-[8px] font-bold uppercase text-sky bg-sky/10 px-1 rounded">Previsto</span>}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-muted">{new Date(div.date).toLocaleDateString('pt-BR')}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold mono">
                          {div.ticker.endsWith('.SA') ? `R$ ${div.amount.toFixed(4)}` : `$ ${div.amount.toFixed(4)}`}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-xs font-black text-emerald mono">
                          {div.ticker.endsWith('.SA') ? `R$ ${div.total.toFixed(2)}` : `$ ${div.total.toFixed(2)}`}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPeriod && (
        <PeriodDetailModal 
          open={showDetail}
          onClose={() => setShowDetail(false)}
          period={selectedPeriod}
          dividends={dividends}
          fmt={fmt}
          currency={currency}
          usdbrl={usdbrl}
        />
      )}
    </div>
  );
}

function PeriodDetailModal({ 
  open, 
  onClose, 
  period, 
  dividends, 
  fmt, 
  currency, 
  usdbrl 
}: { 
  open: boolean; 
  onClose: () => void; 
  period: string; 
  dividends: Dividend[]; 
  fmt: any; 
  currency: string; 
  usdbrl: number; 
}) {
  const [groupBy, setGroupBy] = useState<'ASSET' | 'TYPE'>('ASSET');

  const filteredDividends = useMemo(() => {
    return dividends.filter(div => {
      const d = new Date(div.date);
      const key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
      return key === period || d.getFullYear().toString() === period;
    });
  }, [dividends, period]);

  const total = useMemo(() => {
    return filteredDividends.reduce((acc, div) => {
      // Normalize to USD for fmt() helper
      const isBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
      const rate = isBRL ? (1 / usdbrl) : 1;
      return acc + (div.total * rate);
    }, 0);
  }, [filteredDividends, usdbrl]);

  const distribution = useMemo(() => {
    const map: Record<string, number> = {};
    filteredDividends.forEach(div => {
      // Normalize to USD
      const isDivBRL = div.currency === 'BRL' || (div.currency === undefined && div.ticker.endsWith('.SA'));
      const rate = isDivBRL ? (1 / usdbrl) : 1;
      let key = '';
      if (groupBy === 'ASSET') {
        key = div.ticker;
      } else {
        // Simple logic for type based on ticker (real app should use metadata)
        key = div.ticker.endsWith('.SA') ? (div.ticker.length > 6 ? 'FIIs' : 'Ações BR') : 'Stocks US';
      }
      map[key] = (map[key] || 0) + (div.total * rate);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredDividends, groupBy, currency, usdbrl]);

  const donutData = {
    labels: distribution.map(d => d.label),
    datasets: [{
      data: distribution.map(d => d.value),
      backgroundColor: COLORS,
      borderWidth: 2,
      borderColor: 'transparent',
      hoverBorderColor: 'transparent',
      cutout: '70%'
    }]
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black tracking-tight">Distribuição em {period}</h2>
        <button onClick={onClose} className="p-2 hover:bg-surface2 rounded-full transition-colors"><X size={20} /></button>
      </div>

      <div className="space-y-8">
        <div className="flex justify-center">
          <div className="inline-flex bg-surface2 p-1 rounded-xl border border-border2">
            <button 
              onClick={() => setGroupBy('ASSET')}
              className={cn("flex items-center gap-2 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", groupBy === 'ASSET' ? "bg-surface shadow-md text-text" : "text-muted hover:text-text")}
            >
              <PieChart size={14} />
              Por Ativo
            </button>
            <button 
              onClick={() => setGroupBy('TYPE')}
              className={cn("flex items-center gap-2 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", groupBy === 'TYPE' ? "bg-surface shadow-md text-text" : "text-muted hover:text-text")}
            >
              <Zap size={14} />
              Por Tipo
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-10">
          <div className="w-64 h-64 relative">
             <Doughnut data={donutData as any} options={{ plugins: { legend: { display: false } }, maintainAspectRatio: false }} />
             <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="text-[10px] font-bold text-muted uppercase tracking-widest">{period}</span>
             </div>
          </div>
          
          <div className="w-full space-y-4">
             <div className="bg-surface2 p-5 rounded-2xl flex justify-between items-center border border-border2/50">
                <span className="text-xs font-bold text-muted uppercase tracking-widest">Total Recebido</span>
                <span className="text-lg font-black text-emerald">+{fmt(total)}</span>
             </div>
             
             <div className="grid grid-cols-1 gap-3">
                {distribution.map((item, i) => (
                  <div key={item.label} className="flex items-center justify-between text-[11px] p-2 hover:bg-surface2/30 rounded-lg transition-colors">
                     <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="font-bold text-muted uppercase tracking-widest mono">{item.label}</span>
                     </div>
                     <div className="flex items-center gap-4">
                        <span className="text-muted font-bold">{fmt(item.value)}</span>
                        <span className="font-black text-text w-12 text-right">
                           {((item.value / (total || 1)) * 100).toFixed(1)}%
                        </span>
                     </div>
                  </div>
                ))}
             </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Component: Dialog ────────────────────────────────────────────────────
function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-xs" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="relative bg-surface border border-border2 p-8 rounded-3xl w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]">
        {children}
      </motion.div>
    </div>
  );
}

// ─── Component: TransactionForm ───────────────────────────────────────────
function TransactionForm({ onClose, onSubmit, initialData }: { onClose: () => void; onSubmit: (tx: Transaction) => void; initialData?: Transaction | null }) {
  const [ticker, setTicker] = useState(initialData?.ticker || '');
  const [type, setType] = useState<TransactionType>(initialData?.type || 'BUY');
  const [date, setDate] = useState(initialData?.date || new Date().toISOString().split('T')[0]);
  const [qty, setQty] = useState(initialData?.quantity?.toString() || '');
  const [price, setPrice] = useState(initialData?.price?.toString() || '');
  const [fee, setFee] = useState(initialData?.fee?.toString() || '0');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(qty);
    const p = parseFloat(price);
    const f = parseFloat(fee);
    if (isNaN(q) || isNaN(p)) return;

    onSubmit({
      id: initialData?.id || `T-${Date.now()}`,
      ticker: ticker.toUpperCase(),
      type,
      date,
      quantity: q,
      price: p,
      fee: f,
      total: q * p
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-bold">{initialData ? 'Editar Operação' : 'Nova Operação'}</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-text"><X size={20} /></button>
      </div>

      <div className="flex gap-2">
        {(['BUY', 'SELL'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all border",
              type === t 
                ? (t === 'BUY' ? "bg-emerald/10 border-emerald text-emerald shadow-lg shadow-emerald/5" : "bg-rose/10 border-rose text-rose shadow-lg shadow-rose/5")
                : "bg-surface2 border-border2 text-muted hover:border-muted2"
            )}
          >
            {t === 'BUY' ? 'Compra' : 'Venda'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-muted tracking-widest pl-1">Data</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full bg-surface2 border border-border2 rounded-xl px-4 py-3 text-sm focus:border-sky outline-hidden transition-all" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-muted tracking-widest pl-1">Ticker</label>
          <input type="text" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="Ex: VWCE" required className="w-full bg-surface2 border border-border2 rounded-xl px-4 py-3 text-sm focus:border-sky outline-hidden transition-all mono" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-muted tracking-widest pl-1">Quantidade</label>
          <input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="0.00" required className="w-full bg-surface2 border border-border2 rounded-xl px-4 py-3 text-sm focus:border-sky outline-hidden transition-all mono" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-muted tracking-widest pl-1">Preço (USD)</label>
          <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" required className="w-full bg-surface2 border border-border2 rounded-xl px-4 py-3 text-sm focus:border-sky outline-hidden transition-all mono" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-bold text-muted tracking-widest pl-1">Taxas / Corretagem</label>
        <input type="number" step="any" value={fee} onChange={e => setFee(e.target.value)} placeholder="0.00" className="w-full bg-surface2 border border-border2 rounded-xl px-4 py-3 text-sm focus:border-sky outline-hidden transition-all mono" />
      </div>

      <div className="bg-surface3/50 p-4 rounded-2xl flex justify-between items-center italic">
        <span className="text-xs text-muted">Total Estimado</span>
        <span className="font-bold text-sky mono">${((parseFloat(qty) || 0) * (parseFloat(price) || 0) + (parseFloat(fee) || 0)).toFixed(2)}</span>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-3 text-sm font-bold text-muted hover:text-text transition-all">Cancelar</button>
        <button type="submit" className="flex-[2] py-3 bg-sky text-surface rounded-xl text-sm font-bold shadow-lg shadow-sky/10 hover:translate-y-[-2px] active:scale-95 transition-all">Salvar Operação</button>
      </div>
    </form>
  );
}

