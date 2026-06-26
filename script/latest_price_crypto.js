const BINANCE_BASE_URL = "https://data-api.binance.vision";
const SUPPORTED_QUOTES = [
    "USDT", "USDC", "FDUSD", "TUSD", "BUSD",
    "USD", "EUR", "TRY", "BRL", "JPY", "GBP", "AUD",
    "BTC", "ETH", "BNB"
];
const QUOTE_ALIASES = {
    "USD": "USDT"
};

function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }
    return `${stock.symbol}`.toUpperCase().endsWith(".CC");
}

function buildDailyCacheKey(prefix) {
    return `${prefix}_${$date.format("yyyyMMdd")}`;
}

function normalizeSymbol(symbol) {
    if (symbol == null) {
        return "";
    }
    return `${symbol}`.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitAppSymbol(symbol) {
    if (symbol == null) {
        return null;
    }

    let normalized = `${symbol}`.trim().toUpperCase();
    if (!normalized.endsWith(".CC")) {
        return null;
    }

    let pairSymbol = normalizeSymbol(normalized.substring(0, normalized.length - 3));
    for (const quote of SUPPORTED_QUOTES) {
        if (pairSymbol.length > quote.length && pairSymbol.endsWith(quote)) {
            let base = pairSymbol.substring(0, pairSymbol.length - quote.length);
            let providerQuote = QUOTE_ALIASES[quote] || quote;
            return {
                base: base,
                quote: quote,
                providerQuote: providerQuote,
                providerSymbol: `${base}${providerQuote}`
            };
        }
    }

    return null;
}

function providerSymbolFromStockId(stockId) {
    if (stockId == null) {
        return null;
    }
    let normalized = `${stockId}`.trim().toUpperCase();
    if (!normalized.startsWith("BINANCE:")) {
        return null;
    }
    let symbol = normalizeSymbol(normalized.substring("BINANCE:".length));
    return symbol === "" ? null : symbol;
}

function getProviderSymbol(stock) {
    let fromStockId = providerSymbolFromStockId(stock == null ? null : stock.stockId);
    if (fromStockId != null && fromStockId !== "") {
        return fromStockId;
    }

    let pair = splitAppSymbol(stock == null ? null : stock.symbol);
    return pair == null ? null : pair.providerSymbol;
}

function getLatestPriceFromResponse(data, providerSymbol) {
    if (data == null || data === "") {
        return null;
    }

    let parsed = null;
    try {
        parsed = JSON.parse(data);
    } catch (e) {
        parsed = null;
    }

    if (parsed == null) {
        return null;
    }

    let targetSymbol = normalizeSymbol(providerSymbol);
    if (parsed.length == null) {
        let symbol = normalizeSymbol(parsed.symbol);
        return symbol === targetSymbol && parsed.price != null && parsed.price !== "" ? `${parsed.price}` : null;
    }

    for (const item of parsed) {
        if (normalizeSymbol(item == null ? null : item.symbol) !== targetSymbol) {
            continue;
        }
        if (item.price != null && item.price !== "") {
            return `${item.price}`;
        }
    }

    return null;
}

function requestLatestPrice(stocks, resultDict, completion) {
    let requestSymbols = [];
    let originalSymbolMapping = {};

    for (const stock of stocks) {
        let providerSymbol = getProviderSymbol(stock);
        if (providerSymbol == null || providerSymbol === "") {
            continue;
        }

        if (originalSymbolMapping[providerSymbol] == null) {
            requestSymbols.push(providerSymbol);
            originalSymbolMapping[providerSymbol] = [];
        }
        originalSymbolMapping[providerSymbol].push(stock.symbol);
    }

    if (requestSymbols.length === 0) {
        completion();
        return;
    }

    let symbols = encodeURIComponent(JSON.stringify(requestSymbols));
    let request = HTTPRequest.createWithBaseUrl(`${BINANCE_BASE_URL}/api/v3/ticker/price?symbols=${symbols}`);

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                for (const providerSymbol of requestSymbols) {
                    let price = getLatestPriceFromResponse(resp.data, providerSymbol);
                    let originalSymbols = originalSymbolMapping[providerSymbol];
                    if (price != null && price !== "" && originalSymbols != null) {
                        for (const originalSymbol of originalSymbols) {
                            resultDict[originalSymbol] = `${price}`;
                            $cache.save(buildDailyCacheKey(originalSymbol), `${price}`);
                        }
                    }
                }
            }
            completion();
        });
}

function getLatestPriceByStocks(stocks) {
    let resultDict = {};
    let noCachedStocks = [];

    for (const stock of stocks) {
        if (!isMyStock(stock)) {
            continue;
        }

        let symbol = stock.symbol;
        let cachedValue = $cache.get(buildDailyCacheKey(symbol));
        if (cachedValue != undefined) {
            resultDict[symbol] = cachedValue;
        } else {
            noCachedStocks.push(stock);
        }
    }

    if (noCachedStocks.length === 0) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
        return;
    }

    requestLatestPrice(noCachedStocks, resultDict, function() {
        $callback.onNext(resultDict);
        $callback.onCompletion();
    });
}

function main() {
    let stocks = $argument.get("stocks");
    if (stocks == null || stocks.length === 0) {
        $callback.onNext({});
        $callback.onCompletion();
        return;
    }

    getLatestPriceByStocks(stocks);
}
