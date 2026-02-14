function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }

    return stock.symbol.endsWith(".FUT") || stock.symbol.endsWith(".CFD");
}

function getSinaSymbol(symbol) {
    let lastDotIndex = symbol.lastIndexOf(".");
    let part1 = symbol.substring(0, lastDotIndex);
    let part2 = symbol.substring(lastDotIndex + 1);
    if (part2 == "FUT") {
        return `nf_${part1}`;
    }
    if (part2 == "CFD") {
        return `hf_${part1}`;
    }
    return null;
}

function handleSinaResult(data, symbolMapping, resultDict) {
    let dataArray = data.split(';');
    for (const dataItem of dataArray) {
        if (dataItem.trim() === "") {
            continue;
        }

        let itemArray = dataItem.split('=');
        let key = itemArray[0];
        let value = itemArray[1];
        let symbolKey = key.replace('var hq_str_', '').trim();
        let originalSymbol = symbolMapping[symbolKey];

        if (originalSymbol != undefined && value != undefined) {
            let valueArray = value.replace(/"/g, '').split(',');
            let price;
            if (symbolKey.startsWith("nf_")) {
                price = valueArray[8];
            } else if (symbolKey.startsWith("hf_")) {
                price = valueArray[0];
            }

            if (price && price !== "") {
                resultDict[originalSymbol] = price;

                let cachedKey = `${originalSymbol}_${$date.format("yyyyMMdd")}`;
                $cache.save(cachedKey, price);
            }
        }
    }
}

function requestBySina(stocks, resultDict, completion) {
    var symbolMapping = {};
    var requestSymbols = [];
    for (const stock of stocks) {
        let sinaSymbol = getSinaSymbol(stock.symbol);
        if (sinaSymbol) {
            symbolMapping[sinaSymbol] = stock.symbol;
            requestSymbols.push(sinaSymbol);
        }
    }

    if (requestSymbols.length === 0) {
        completion();
        return;
    }

    let symbols = requestSymbols.join(',');
    let timestamp = Date.now();
    let baseUrl = `https://hq.sinajs.cn/?_=${timestamp}/&list=${symbols}`;

    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .header("Referer", "https://finance.sina.com.cn");

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleSinaResult(resp.data, symbolMapping, resultDict);
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

    requestBySina(noCachedStocks, resultDict, function() {
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
