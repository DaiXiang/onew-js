const BINANCE_BASE_URL = "https://data-api.binance.vision";
const SUPPORTED_QUOTES = [
    "USDT", "USDC", "FDUSD", "TUSD", "BUSD",
    "USD", "EUR", "TRY", "BRL", "JPY", "GBP", "AUD",
    "BTC", "ETH", "BNB"
];
const QUOTE_ALIASES = {
    "USD": "USDT"
};

function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null && currency !== "") {
        stock.currency = currency;
    }
}

function stripHtmlTags(text) {
    if (text == null) {
        return "";
    }
    return `${text}`.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function normalizeKeyword(keyword) {
    return stripHtmlTags(keyword).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeSymbol(symbol) {
    if (symbol == null) {
        return "";
    }
    return `${symbol}`.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitPair(providerSymbol) {
    let symbol = normalizeSymbol(providerSymbol);
    for (const quote of SUPPORTED_QUOTES) {
        if (symbol.length > quote.length && symbol.endsWith(quote)) {
            let base = symbol.substring(0, symbol.length - quote.length);
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

function createStockFromPair(pair) {
    if (pair == null || pair.base === "" || pair.quote === "") {
        return null;
    }

    let appSymbol = `${pair.base}${pair.quote}.CC`;
    let name = `${pair.base}/${pair.quote}`;
    let stock = Stock.create(appSymbol, name);
    stock.stockId = `binance:${pair.providerSymbol}`;
    setCurrencyIfNeed(stock, pair.quote);
    return stock;
}

function shouldIncludePair(pair, keyword) {
    if (pair == null || keyword === "") {
        return false;
    }
    return pair.base.indexOf(keyword) >= 0 ||
        pair.quote.indexOf(keyword) >= 0 ||
        `${pair.base}${pair.quote}`.indexOf(keyword) >= 0;
}

function handleResult(data, keyword) {
    let normalizedKeyword = normalizeKeyword(keyword);
    if (normalizedKeyword === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let items = null;
    try {
        items = JSON.parse(data);
    } catch (e) {
        items = null;
    }

    if (items == null || items.length == null) {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let stocks = [];
    let cached = {};

    for (const item of items) {
        let pair = splitPair(item == null ? null : item.symbol);
        if (!shouldIncludePair(pair, normalizedKeyword)) {
            continue;
        }

        let stock = createStockFromPair(pair);
        if (stock == null) {
            continue;
        }

        let key = `${stock.symbol}#${stock.stockId}`;
        if (cached[key] === "1") {
            continue;
        }
        cached[key] = "1";
        stocks.push(stock);

        if (stocks.length >= 30) {
            break;
        }
    }

    $callback.onNext(stocks.length === 0 ? null : stocks);
    $callback.onCompletion();
}

function search() {
    let keyword = $argument.get("keyword");
    if (normalizeKeyword(keyword) === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let request = HTTPRequest.createWithBaseUrl(`${BINANCE_BASE_URL}/api/v3/ticker/price`);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(null);
                $callback.onCompletion();
                return;
            }

            handleResult(resp.data, keyword);
        });
}

function main() {
    search();
}
