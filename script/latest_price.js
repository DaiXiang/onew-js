function getCurrentDate() {
    const today = new Date(); // 创建一个当前时间的日期对象
    const year = today.getFullYear(); // 获取当前年份
    const month = today.getMonth() + 1; // 获取当前月份（0-11，需要加1）
    const date = today.getDate(); // 获取当前日期（1-31）
    return `${year}-${month}-${date}`;
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

function handleResult(data, symbolMapping, resultDict, needCheck) {
    let dataArray = data.split(';');
    for (const dataItem of dataArray) {
        let itemArray = dataItem.split('=');
        let key = itemArray[0];
        let value = itemArray[1];
        let symbolKey = key.replace('v_', '').trim();
        let orginalSymbol = symbolMapping[symbolKey];
        if (orginalSymbol != undefined) {
            let valueArray = value.split('~');
            let price = valueArray[3];
            resultDict[orginalSymbol] = price;
            
            let cachedKey = `${orginalSymbol}_${getCurrentDate()}`;
            $cache.save(cachedKey, price);
        }
    }
    
    checkResult(resultDict, needCheck);
}

function requestLatestPrice(symbolList, resultDict) {
    var symbolMapping = {};
    var requestSymbols = [];
    for (const symbol of symbolList) {
        let transformedSymbol = getTransformedSymbol(symbol);
        symbolMapping[transformedSymbol] = symbol;
        requestSymbols.push(transformedSymbol);
    }
    
    let symbols = requestSymbols.join(',');
    let baseUrl = `https://qt.gtimg.cn/q=${symbols}`;
    
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(resultDict);
                $callback.onCompletion();
                return;
            }

            let data = resp.data;
            handleResult(data, symbolMapping, resultDict, false);
        });
}

function getLatestPrice() {
    let symbolList = $argument.get("symbols");
    
    var resultDict = {};
    var noCachedSymbols = [];
    
    for (const symbol of symbolList) {
        let cachedKey = `${symbol}_${getCurrentDate()}`;
        let cachedValue = $cache.get(cachedKey);
        if (cachedValue != undefined) {
            resultDict[symbol] = cachedValue;
        } else {
            noCachedSymbols.push(symbol);
        }
    }
    
    if (noCachedSymbols.length === 0) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
        return
    }
    
    requestLatestPrice(noCachedSymbols, resultDict);
}

function checkInRequest(resultDict, inRequest) {
    if (inRequest.length === 0) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
    }
}

function handleFRSResult(data, symbol, resultDict, inRequest) {
    let result = JSON.parse(data);
    let price = result.data.newPrice;
    resultDict[symbol] = price;
    
    let cachedKey = `${symbol}_${getCurrentDate()}`;
    $cache.save(cachedKey, price);
    
    inRequest.pop();
    checkInRequest(resultDict, inRequest);
}

function requestLatestPriceByFRS(symbol, stockId, resultDict, inRequest) {
    $console.log(`requestLatestPriceByFRS ${symbol}`);
    inRequest.push(true);
    
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
            if (resp.error != null || resp.data === "") {
                inRequest.pop();
                checkInRequest(resultDict, inRequest);
                return;
            }

            handleFRSResult(resp.data, symbol, resultDict, inRequest)
        });
}

function requestWithStockId(stocks, resultDict) {
    $console.log(`requestWithStockId`);
    var inRequest = [];
    for (const stock of stocks) {
        let stockId = stock.stockId
        if (stockId.startsWith("frs")) {
            requestLatestPriceByFRS(stock.symbol, stockId, resultDict, inRequest);
        }
    }
    
    checkInRequest(resultDict, inRequest);
}

function checkResult(resultDict, needCheck) {
    if (!needCheck) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
    }
}

function requestWithoutStockId(stocks, resultDict, needCheck) {
    var symbolMapping = {};
    var requestSymbols = [];
    for (const stock of stocks) {
        let symbol = stock.symbol
        let transformedSymbol = getTransformedSymbol(symbol);
        symbolMapping[transformedSymbol] = symbol;
        requestSymbols.push(transformedSymbol);
    }
    
    let symbols = requestSymbols.join(',');
    let baseUrl = `https://qt.gtimg.cn/q=${symbols}`;
    
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                checkResult(resultDict, needCheck);
                return;
            }

            let data = resp.data;
            handleResult(data, symbolMapping, resultDict, needCheck);
        });
}

function getLatestPriceByStocks(stocks) {
    var resultDict = {};
    var noCachedStocks = [];
    var noCachedStocksWithStockId = [];
    
    for (const stock of stocks) {
        let symbol = stock.symbol;
        let cachedKey = `${symbol}_${getCurrentDate()}`;
        let cachedValue = $cache.get(cachedKey);
        if (cachedValue != undefined) {
            resultDict[symbol] = cachedValue;
        } else if (stock.stockId != undefined && stock.stockId.length > 0) {
            noCachedStocksWithStockId.push(stock);
        } else {
            noCachedStocks.push(stock);
        }
    }
    
    if (noCachedStocks.length === 0 && noCachedStocksWithStockId.length === 0) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
        return
    }
    
    let needCheck = noCachedStocksWithStockId.length > 0;
    if (noCachedStocks.length > 0) {
        $console.log(`getLatestPriceByStocks needCheck: ${needCheck}`);
        requestWithoutStockId(noCachedStocks, resultDict, needCheck)
    }
    if (noCachedStocksWithStockId.length > 0) {
        requestWithStockId(noCachedStocksWithStockId, resultDict)
    }
}

function main() {
    let stocks = $argument.get("stocks");
    if (stocks != null && stocks.length > 0) {
        getLatestPriceByStocks(stocks)
    } else {
        getLatestPrice();
    }
}
