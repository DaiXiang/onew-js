function getCurrentDate() {
    const today = new Date(); // 创建一个当前时间的日期对象
    const year = today.getFullYear(); // 获取当前年份
    const month = today.getMonth() + 1; // 获取当前月份（0-11，需要加1）
    const date = today.getDate(); // 获取当前日期（1-31）
    return `${year}-${month}-${date}`;
}

function getTransformedSymbol(symbol) {
    var array = symbol.split('.');
    if (array[1] == "OF") {
        return `jj${array[0]}`;
    }
    return `${array[1].toLowerCase()}${array[0]}`;
}

function handleResult(data, symbolMapping, resultDict) {
    let dataArray = data.split(';');
    for (const dataItem of dataArray) {
        let itemArray = dataItem.split('=');
        let key = itemArray[0];
        let value = itemArray[1];
        let keyArray = key.split('_');
        let orginalSymbol = symbolMapping[keyArray[keyArray.length - 1]]
        if (orginalSymbol != undefined) {
            let valueArray = value.split('~');
            let price = valueArray[3];
            resultDict[orginalSymbol] = price;
            
            let cachedKey = `${orginalSymbol}_${getCurrentDate()}`;
            $cache.save(cachedKey, price);
        }
    }
    
    $callback.onNext(resultDict);
    $callback.onCompletion();
}

function requestLatestPrice(symbolList, resultDict) {
    var symbolMapping = {};
    var requestSymbols = [];
    for (const symbol of symbolList) {
        let transformedSymbol = getTransformedSymbol(symbol);
        symbolMapping[transformedSymbol] = symbol;
        requestSymbols.push(`s_${transformedSymbol}`);
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
            handleResult(data, symbolMapping, resultDict);
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

function main() {
    getLatestPrice();
}
