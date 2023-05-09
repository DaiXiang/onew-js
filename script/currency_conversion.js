function getCurrentDate() {
    const today = new Date(); // 创建一个当前时间的日期对象
    const year = today.getFullYear(); // 获取当前年份
    const month = today.getMonth() + 1; // 获取当前月份（0-11，需要加1）
    const date = today.getDate(); // 获取当前日期（1-31）
    return `${year}-${month}-${date}`;
}

function requestConversionIfNeed(fromCurrency, toCurrency, callback) {
    let cachedKey = fromCurrency + "/" + toCurrency + "_" + getCurrentDate();
    let cachedValue = $cache.get(cachedKey);
    
    if (cachedValue != undefined) {
        callback(cachedValue);
        return;
    }
    
    requestConversion(fromCurrency, toCurrency, callback);
}

function requestConversion(fromCurrency, toCurrency, callback) {
    let baseUrl = "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/" + fromCurrency.toLowerCase() + "/" + toCurrency.toLowerCase() + ".json";
    let request = HTTPRequest.createWithBaseUrl(baseUrl);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                callback(null);
                return;
            }
            
            let data = JSON.parse(resp.data);
            let rate = data[toCurrency.toLowerCase()];
            
            let cachedKey = fromCurrency + "/" + toCurrency + "_" + getCurrentDate();
            $cache.save(cachedKey, rate);
            
            callback(String(rate));
        });
}

function getCurrencyRate() {
    let fromList = $argument.get("from");
    let toCurrency = $argument.get("to");
    let totalCount = fromList.length;
    
    var resultDict = {};
    var count = 0;
    for (const fromCurrency of fromList) {
        requestConversionIfNeed(fromCurrency, toCurrency, function(result) {
            if (result != null && result !== "") {
                resultDict[`${fromCurrency}/${toCurrency}`] = result;
            }
            count += 1;
            if (count >= totalCount) {
                $callback.onNext(resultDict);
                $callback.onCompletion();
            }
        });
    }
}

function main() {
    getCurrencyRate();
}
