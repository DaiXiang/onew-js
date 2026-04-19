function isMyStock(stock) {
    if (stock == null || stock.stockId == null || stock.stockId === "") {
        return false;
    }

    return stock.stockId.startsWith("msf") && !hasFundsquareISIN(stock.symbol);
}

function hasFundsquareISIN(symbol) {
    if (symbol == null) {
        return false;
    }

    let normalized = `${symbol}`.trim().toUpperCase();
    if (!normalized.endsWith(".FUND")) {
        return false;
    }

    let isin = normalized.substring(0, normalized.length - 5);
    return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin);
}

function buildDailyCacheKey(prefix) {
    return `${prefix}_${$date.format("yyyyMMdd")}`;
}

function parseMSToken(data) {
    if (data == null || data === "") {
        return null;
    }

    try {
        let result = JSON.parse(data);
        if (result == null || result.token == null || result.token === "") {
            return null;
        }
        return `${result.token}`.trim();
    } catch (e) {
        return null;
    }
}

function getMSToken(completion) {
    let cacheKey = buildDailyCacheKey("ms_token");
    let cachedToken = $cache.getPersistent(cacheKey);
    if (cachedToken != null && cachedToken !== "") {
        completion(cachedToken);
        return;
    }

    let tokenUrl = "https://global.morningstar.com/api/v1/en-ea/oauth/token/";
    let request = HTTPRequest.createWithBaseUrl(tokenUrl).get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                completion(null);
                return;
            }

            let token = parseMSToken(resp.data);
            if (token != null && token !== "") {
                $cache.savePersistent(cacheKey, token);
            }
            completion(token);
        });
}

function handleResult(data, symbol, resultDict) {
    try {
        let result = JSON.parse(data);
        if (result == null) {
            return;
        }

        let price = result.latestPrice;
        if (price == null || price === "") {
            price = result.nav;
        }
        if (price == null || price === "") {
            return;
        }

        resultDict[symbol] = `${price}`;

        let cachedKey = buildDailyCacheKey(symbol);
        $cache.save(cachedKey, `${price}`);
    } catch (e) {
    }
}

function requestLatestPriceByMS(symbol, stockId, token, resultDict, completion) {
    let secId = stockId.replace("msf", "");
    if (secId === "") {
        completion();
        return;
    }

    let baseUrl = `https://api-global.morningstar.com/sal-service/v1/fund/quote/v7/${secId}/data`;
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .params({
            "fundServCode": "",
            "showAnalystRatingChinaFund": "false",
            "showAnalystRating": "false",
            "hideesg": "false",
            "region": "",
            "locale": "en-ea",
            "clientId": "MDC",
            "benchmarkId": "mstarorcat",
            "version": "4.78.0",
            "access_token": token,
            "secId": secId
        })
        .get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleResult(resp.data, symbol, resultDict);
            }
            completion();
        });
}

function requestWithStockId(stocks, resultDict, completion) {
    if (stocks.length === 0) {
        completion();
        return;
    }

    getMSToken(function(token) {
        if (token == null || token === "") {
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
            requestLatestPriceByMS(stock.symbol, stock.stockId, token, resultDict, onRequestFinished);
        }
    });
}

function getLatestPriceByStocks(stocks) {
    var resultDict = {};
    var noCachedStocks = [];

    for (const stock of stocks) {
        if (!isMyStock(stock)) {
            continue;
        }

        let symbol = stock.symbol;
        let cachedKey = buildDailyCacheKey(symbol);
        let cachedValue = $cache.get(cachedKey);
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

    requestWithStockId(noCachedStocks, resultDict, function() {
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
