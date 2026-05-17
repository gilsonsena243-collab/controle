import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to proxy Yahoo Finance or other finance data
  app.get("/api/price/:symbols", async (req, res) => {
    try {
      const { symbols } = req.params;
      
      // Try quote endpoint first with better headers
      const fetchWithHeaders = async (url: string) => {
        return fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://finance.yahoo.com',
            'Referer': 'https://finance.yahoo.com/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
      };

      let response = await fetchWithHeaders(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`);
      
      if (!response.ok) {
        response = await fetchWithHeaders(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`);
      }

      // If failing with 401, they are enforcing crumbs/sessions for the quote endpoint.
      // We'll try the spark endpoint which is often more permissive and supports batching.
      if (!response.ok) {
        const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1d&interval=5m`;
        const sparkResponse = await fetchWithHeaders(sparkUrl);
        
        if (sparkResponse.ok) {
          const sparkData: any = await sparkResponse.json();
          const results = sparkData?.spark?.result || [];
          
          if (results.length > 0) {
            const mappedResult = results.map((res: any) => {
              const meta = res.response?.[0]?.meta;
              if (!meta) return null;
              return {
                symbol: res.symbol,
                regularMarketPrice: meta.regularMarketPrice,
                regularMarketChange: meta.regularMarketPrice - meta.previousClose,
                regularMarketChangePercent: ((meta.regularMarketPrice / meta.previousClose) - 1) * 100,
                currency: meta.currency,
                exchangeName: meta.exchangeName
              };
            }).filter(Boolean);

            if (mappedResult.length > 0) {
              return res.json({
                quoteResponse: {
                  result: mappedResult
                }
              });
            }
          }
        }
      }

      // Last ditch effort for single symbols - Chart API
      if (!response.ok && !symbols.includes(',')) {
        const chartResponse = await fetchWithHeaders(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbols)}?interval=1m&range=1d`);
        if (chartResponse.ok) {
          const chartData: any = await chartResponse.json();
          const result = chartData?.chart?.result?.[0];
          if (result) {
            const meta = result.meta;
            return res.json({
              quoteResponse: {
                result: [{
                  symbol: symbols,
                  regularMarketPrice: meta.regularMarketPrice,
                  regularMarketChange: meta.regularMarketPrice - meta.previousClose,
                  regularMarketChangePercent: ((meta.regularMarketPrice / meta.previousClose) - 1) * 100,
                  currency: meta.currency,
                  exchangeName: meta.exchangeName
                }]
              }
            });
          }
        }
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error body");
        console.warn(`Yahoo Finance API failed (${response.status}) - Headers restricted or crumb required.`);
        return res.status(response.status).json({ 
          error: "Failed to fetch from Yahoo Finance", 
          status: response.status 
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/dividends/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      // Chart API is still better for dividends history
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y&events=div`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch dividends" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Dividends proxy error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/index/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params; // Expecting things like ^BVSP or ^GSPC
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=2y`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch index" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Index proxy error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
