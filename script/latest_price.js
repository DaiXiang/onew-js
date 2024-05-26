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

function handleResult(data, symbolMapping, resultDict) {
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
    
    $callback.onNext(resultDict);
    $callback.onCompletion();
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
