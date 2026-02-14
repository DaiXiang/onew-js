function getCurrentDate() {
    if ($app.apiLevel >= 4) {
        return $date.format("yyyyMMdd");
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const date = today.getDate();
    return `${year}-${month}-${date}`;
}

function normalizeCurrency(currency) {
    if (currency == null) {
        return "";
    }
    return `${currency}`.trim().toUpperCase();
}

function getCacheKey(fromCurrency, toCurrency) {
    return `${fromCurrency}/${toCurrency}_${getCurrentDate()}`;
}

const CDN_PRIORITY_DEFAULT = ["fastly", "cdn", "gcore"];
const CDN_PRIORITY_CACHE_KEY = "currency_cdn_priority";

function normalizeCdnOrder(cdnList) {
    if (cdnList == null || cdnList.length === 0) {
        return CDN_PRIORITY_DEFAULT.slice();
    }

    var normalizedList = [];
    var visited = {};
    for (const cdn of cdnList) {
        if (CDN_PRIORITY_DEFAULT.indexOf(cdn) < 0 || visited[cdn] === "1") {
            continue;
        }
        visited[cdn] = "1";
        normalizedList.push(cdn);
    }

    for (const cdn of CDN_PRIORITY_DEFAULT) {
        if (visited[cdn] !== "1") {
            normalizedList.push(cdn);
        }
    }
    return normalizedList;
}

function loadCdnOrder() {
    let cachedValue;
    if ($app.apiLevel >= 4) {
        cachedValue = $cache.getPersistent(CDN_PRIORITY_CACHE_KEY);
    } else {
        cachedValue = $cache.get(CDN_PRIORITY_CACHE_KEY);
    }

    if (cachedValue == undefined || cachedValue === "") {
        return CDN_PRIORITY_DEFAULT.slice();
    }

    try {
        let payload = JSON.parse(cachedValue);
        return normalizeCdnOrder(payload);
    } catch (e) {
        return CDN_PRIORITY_DEFAULT.slice();
    }
}

function saveCdnOrder(cdnList) {
    let payload = normalizeCdnOrder(cdnList);

    if ($app.apiLevel >= 4) {
        $cache.savePersistent(CDN_PRIORITY_CACHE_KEY, JSON.stringify(payload));
    } else {
        $cache.save(CDN_PRIORITY_CACHE_KEY, JSON.stringify(payload));
    }
}

function updateCdnOrderOnSuccess(currentOrder, successCdn) {
    if (successCdn == null || successCdn === "") {
        return;
    }

    var newOrder = normalizeCdnOrder(currentOrder);
    let index = newOrder.indexOf(successCdn);
    if (index === 0) {
        saveCdnOrder(newOrder);
        return;
    }

    if (index > 0) {
        newOrder.splice(index, 1);
        newOrder.unshift(successCdn);
        saveCdnOrder(newOrder);
        return;
    }

    if (index < 0) {
        newOrder.unshift(successCdn);
        saveCdnOrder(newOrder);
    }
}

function requestConversionIfNeed(fromCurrency, toCurrency, callback) {
    if (fromCurrency === "" || toCurrency === "") {
        callback(null);
        return;
    }

    let cachedKey = getCacheKey(fromCurrency, toCurrency);
    let cachedValue = $cache.get(cachedKey);
    if (cachedValue != undefined && cachedValue !== "") {
        callback(`${cachedValue}`);
        return;
    }

    let cdnOrder = loadCdnOrder();
    requestConversionWithFallback(cdnOrder, 0, fromCurrency, toCurrency, function(result, successCdn) {
        if (result != null && result !== "") {
            updateCdnOrderOnSuccess(cdnOrder, successCdn);
            callback(result);
            return;
        }
        callback(null);
    });
}

function requestConversionWithFallback(subDomains, index, fromCurrency, toCurrency, callback) {
    if (index >= subDomains.length) {
        callback(null, null);
        return;
    }

    let currentSubDomain = subDomains[index];
    requestConversion(currentSubDomain, fromCurrency, toCurrency, function(result) {
        if (result != null && result !== "") {
            callback(result, currentSubDomain);
            return;
        }
        requestConversionWithFallback(subDomains, index + 1, fromCurrency, toCurrency, callback);
    });
}

function requestConversion(subDomain, fromCurrency, toCurrency, callback) {
    let fromCurrencyLower = fromCurrency.toLowerCase();
    let toCurrencyLower = toCurrency.toLowerCase();
    let baseUrl = `https://${subDomain}.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromCurrencyLower}.min.json`;
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .timeout(3);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                callback(null);
                return;
            }

            try {
                let data = JSON.parse(resp.data);
                let baseMap = data[fromCurrencyLower];
                let rate = baseMap ? baseMap[toCurrencyLower] : undefined;
                if (rate == undefined || rate == 0) {
                    callback(null);
                    return;
                }

                let rateStr = `${rate}`;
                $cache.save(getCacheKey(fromCurrency, toCurrency), rateStr);
                callback(rateStr);
            } catch (e) {
                callback(null);
            }
        });
}

function getUniqueCurrencyList(currencyList) {
    if (currencyList == null || currencyList.length === 0) {
        return [];
    }

    var uniqueList = [];
    var visited = {};
    for (const currency of currencyList) {
        let normalizedCurrency = normalizeCurrency(currency);
        if (normalizedCurrency === "" || visited[normalizedCurrency] === "1") {
            continue;
        }
        visited[normalizedCurrency] = "1";
        uniqueList.push(normalizedCurrency);
    }
    return uniqueList;
}

function getCurrencyRate() {
    let fromList = getUniqueCurrencyList($argument.get("from"));
    let toCurrency = normalizeCurrency($argument.get("to"));

    if (fromList.length === 0 || toCurrency === "") {
        $callback.onNext({});
        $callback.onCompletion();
        return;
    }

    var resultDict = {};
    var pending = fromList.length;

    function complete() {
        pending--;
        if (pending <= 0) {
            $callback.onNext(resultDict);
            $callback.onCompletion();
        }
    }

    for (const fromCurrency of fromList) {
        if (fromCurrency === toCurrency) {
            let sameRate = "1";
            resultDict[`${fromCurrency}/${toCurrency}`] = sameRate;
            $cache.save(getCacheKey(fromCurrency, toCurrency), sameRate);
            complete();
            continue;
        }

        requestConversionIfNeed(fromCurrency, toCurrency, function(result) {
            if (result != null && result !== "") {
                resultDict[`${fromCurrency}/${toCurrency}`] = result;
            }
            complete();
        });
    }
}

function main() {
    getCurrencyRate();
}
