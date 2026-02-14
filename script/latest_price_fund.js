function isMyStock(stock) {
    if (stock == null || stock.stockId == null || stock.stockId === "") {
        return false;
    }

    return stock.stockId.startsWith("frs");
}

function handleFRSResult(data, symbol, resultDict) {
    try {
        let result = JSON.parse(data);
        let price = result && result.data ? result.data.newPrice : null;
        if (price == null || price === "") {
            return;
        }

        resultDict[symbol] = `${price}`;

        let cachedKey = `${symbol}_${$date.format("yyyyMMdd")}`;
        $cache.save(cachedKey, `${price}`);
    } catch (e) {
    }
}

function requestLatestPriceByFRS(symbol, stockId, resultDict, completion) {
    let fundId = stockId.replace("frs", "");
    let baseUrl = "https://apis.fundrich.com.tw/FRSDataCenter/GetFundDetail";
    let body = {
        "data": {
            "fundId": fundId
        }
    };

    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .header("Content-Type", "application/json")
        .paramsBody(body)
        .post();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleFRSResult(resp.data, symbol, resultDict);
            }
            completion();
        });
}

function requestWithStockId(stocks, resultDict, completion) {
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
        requestLatestPriceByFRS(stock.symbol, stock.stockId, resultDict, onRequestFinished);
    }
}

function getLatestPriceByStocks(stocks) {
    var resultDict = {};
    var noCachedStocks = [];

    for (const stock of stocks) {
        if (!isMyStock(stock)) {
            continue;
        }

        let symbol = stock.symbol;
        let cachedKey = `${symbol}_${$date.format("yyyyMMdd")}`;
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
