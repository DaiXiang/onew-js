function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }
    return `${stock.symbol}`.toUpperCase().endsWith(".CC");
}

function buildDailyCacheKey(prefix) {
    return `${prefix}_${$date.format("yyyyMMdd")}`;
}

function stripHtmlTags(text) {
    if (text == null) {
        return "";
    }
    return `${text}`.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function extractPayload(data) {
    if (data == null || data === "") {
        return null;
    }

    let match = `${data}`.match(/window\.cmp_r\('([\s\S]*)'\);?/);
    if (match == null || match[1] == null || match[1] === "") {
        return null;
    }

    return `${match[1]}`.replace(/\\'/g, "'");
}

function toProviderSymbol(symbol) {
    if (symbol == null) {
        return null;
    }
    let normalized = `${symbol}`.trim().toUpperCase();
    if (!normalized.endsWith(".CC")) {
        return null;
    }
    return `${normalized.substring(0, normalized.length - 3)}.V`;
}

function getLatestPriceFromPayload(payload, providerSymbol) {
    if (payload == null || payload === "") {
        return null;
    }

    let targetSymbol = `${providerSymbol}`.trim().toUpperCase();
    let dataArray = payload.split("|");
    for (const dataItem of dataArray) {
        if (dataItem == null || dataItem.trim() === "") {
            continue;
        }

        let fields = dataItem.split("~");
        if (fields.length < 4) {
            continue;
        }

        let symbol = stripHtmlTags(fields[0]).toUpperCase();
        if (symbol !== targetSymbol) {
            continue;
        }

        let price = fields[3] == null ? "" : `${fields[3]}`.trim();
        return price === "" ? null : price;
    }

    return null;
}

function requestLatestPrice(symbol, providerSymbol, resultDict, completion) {
    let baseUrl = `https://stooq.com/cmp/?${Date.now()}&q=${encodeURIComponent(providerSymbol)}`;
    let request = HTTPRequest.createWithBaseUrl(baseUrl);

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                let payload = extractPayload(resp.data);
                let price = getLatestPriceFromPayload(payload, providerSymbol);
                if (price != null && price !== "") {
                    resultDict[symbol] = `${price}`;
                    $cache.save(buildDailyCacheKey(symbol), `${price}`);
                }
            }
            completion();
        });
}

function requestByStocks(stocks, resultDict, completion) {
    if (stocks.length === 0) {
        completion();
        return;
    }

    let pending = stocks.length;
    function onRequestFinished() {
        pending--;
        if (pending === 0) {
            completion();
        }
    }

    for (const stock of stocks) {
        let providerSymbol = toProviderSymbol(stock.symbol);
        if (providerSymbol == null || providerSymbol === "") {
            onRequestFinished();
            continue;
        }
        requestLatestPrice(stock.symbol, providerSymbol, resultDict, onRequestFinished);
    }
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

    requestByStocks(noCachedStocks, resultDict, function() {
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
