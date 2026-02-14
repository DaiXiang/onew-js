function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }

    if (stock.stockId != undefined && stock.stockId.length > 0 && stock.stockId.startsWith("frs")) {
        return false;
    }

    return !stock.symbol.endsWith(".FUT") && !stock.symbol.endsWith(".CFD");
}

function getTransformedSymbol(symbol) {
    let lastDotIndex = symbol.lastIndexOf(".");
    let part1 = symbol.substring(0, lastDotIndex);
    let part2 = symbol.substring(lastDotIndex + 1);
    if (part2 == "OF") {
        return `s_jj${part1}`;
    }
    if (part2 == "FX") {
        return `wh${part1}`;
    }
    return `s_${part2.toLowerCase()}${part1}`;
}

function handleResult(data, symbolMapping, resultDict) {
    let dataArray = data.split(';');
    for (const dataItem of dataArray) {
        let itemArray = dataItem.split('=');
        let key = itemArray[0];
        let value = itemArray[1];
        let symbolKey = key.replace('v_', '').trim();
        let originalSymbol = symbolMapping[symbolKey];
        if (originalSymbol != undefined && value != undefined) {
            let valueArray = value.split('~');
            let price = valueArray[3];
            if (price != undefined && price !== "") {
                resultDict[originalSymbol] = price;

                let cachedKey = `${originalSymbol}_${$date.format("yyyyMMdd")}`;
                $cache.save(cachedKey, price);
            }
        }
    }
}

function requestLatestPrice(stocks, resultDict, completion) {
    var symbolMapping = {};
    var requestSymbols = [];
    for (const stock of stocks) {
        let transformedSymbol = getTransformedSymbol(stock.symbol);
        symbolMapping[transformedSymbol] = stock.symbol;
        requestSymbols.push(transformedSymbol);
    }

    if (requestSymbols.length === 0) {
        completion();
        return;
    }

    let symbols = requestSymbols.join(',');
    let baseUrl = `https://qt.gtimg.cn/q=${symbols}`;

    let request = HTTPRequest.createWithBaseUrl(baseUrl);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleResult(resp.data, symbolMapping, resultDict);
            }
            completion();
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
