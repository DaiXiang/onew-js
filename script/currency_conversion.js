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
    
    requestConversion("fastly", fromCurrency, toCurrency, function(result) {
        if (result != null && result !== "") {
            callback(result);
            return;
        }
        requestConversion("cdn", fromCurrency, toCurrency, function(result) {
            if (result != null && result !== "") {
                callback(result);
                return;
            }
            requestConversion("gcore", fromCurrency, toCurrency, callback);
        });
    });
}

function requestConversion(subDomain, fromCurrency, toCurrency, callback) {
    // https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/btc.min.json
    let baseUrl = "https://" + subDomain + ".jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/" + fromCurrency.toLowerCase() + ".min.json";
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .timeout(3);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                callback(null);
                return;
            }
            
            let data = JSON.parse(resp.data);
            let rate = data[fromCurrency.toLowerCase()][toCurrency.toLowerCase()];
            
            // rate is zero, not available
            if (rate == undefined || rate == 0) {
                callback(null);
                return;
            }
            
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
