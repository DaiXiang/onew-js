function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }
    return `${stock.symbol}`.toUpperCase().endsWith(".OPT");
}

function strip(text) {
    if (text == null) {
        return "";
    }
    return `${text}`.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function cleanNumber(text) {
    let value = strip(text).replace(/\$/g, "").replace(/,/g, "");
    if (value === "" || value === "--" || value.toLowerCase() === "nan") {
        return null;
    }
    return value;
}

function padLeft(text, length) {
    let value = `${text}`;
    while (value.length < length) {
        value = `0${value}`;
    }
    return value;
}

function parseOptionSymbol(symbol) {
    let normalized = strip(symbol).toUpperCase();
    if (!normalized.endsWith(".OPT")) {
        return null;
    }
    normalized = normalized.substring(0, normalized.length - 4);

    let match = normalized.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
    if (match == null) {
        return null;
    }

    let year = 2000 + Number(match[2]);
    let month = Number(match[3]);
    let day = Number(match[4]);
    return {
        symbol: `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${match[6]}.OPT`,
        underlying: match[1],
        date: `${year}-${padLeft(month, 2)}-${padLeft(day, 2)}`,
        type: match[5],
        strikeCode: match[6],
        strike: Number(match[6]) / 1000
    };
}

function buildDailyCacheKey(symbol) {
    return `${symbol}_${$date.format("yyyyMMdd")}`;
}

function makeNasdaqRequest(baseUrl) {
    return HTTPRequest.createWithBaseUrl(baseUrl)
        .header("Accept", "application/json, text/plain, */*")
        .header("Origin", "https://www.nasdaq.com")
        .header("Referer", "https://www.nasdaq.com/")
        .header("User-Agent", "Mozilla/5.0");
}

function normalizePrice(value) {
    let cleaned = cleanNumber(value);
    if (cleaned == null) {
        return null;
    }
    let number = Number(cleaned);
    if (!isFinite(number)) {
        return null;
    }
    return `${number}`;
}

function getOptionPrice(row, type) {
    let last = normalizePrice(type === "C" ? row.c_Last : row.p_Last);
    if (last != null) {
        return last;
    }

    let bid = normalizePrice(type === "C" ? row.c_Bid : row.p_Bid);
    let ask = normalizePrice(type === "C" ? row.c_Ask : row.p_Ask);
    if (bid != null && ask != null) {
        return `${(Number(bid) + Number(ask)) / 2}`;
    }
    return bid != null ? bid : ask;
}

function isSameStrike(rowStrike, targetStrike) {
    let cleaned = cleanNumber(rowStrike);
    if (cleaned == null) {
        return false;
    }
    return Math.abs(Number(cleaned) - targetStrike) < 0.0001;
}

function handleOptionChain(data, requests, resultDict) {
    let json = null;
    try {
        json = JSON.parse(data);
    } catch (e) {
        return;
    }

    let rows = json == null || json.data == null || json.data.table == null ? [] : json.data.table.rows;
    for (const row of rows) {
        if (row == null || strip(row.strike) === "") {
            continue;
        }

        for (const request of requests) {
            if (!isSameStrike(row.strike, request.strike)) {
                continue;
            }

            let price = getOptionPrice(row, request.type);
            if (price != null && price !== "") {
                resultDict[request.symbol] = price;
                $cache.save(buildDailyCacheKey(request.symbol), price);
            }
        }
    }
}

function hasResolvedAnyRequest(requests, resultDict) {
    for (const request of requests) {
        if (resultDict[request.symbol] != null) {
            return true;
        }
    }
    return false;
}

function requestOptionGroup(groupKey, requests, resultDict, completion) {
    if (requests.length === 0) {
        completion();
        return;
    }

    requestOptionGroupByAssetClass(requests, ["stocks", "etf"], 0, resultDict, completion);
}

function requestOptionGroupByAssetClass(requests, assetClasses, index, resultDict, completion) {
    if (index >= assetClasses.length) {
        completion();
        return;
    }

    let first = requests[0];
    let assetClass = assetClasses[index];
    let url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(first.underlying)}/option-chain?assetclass=${assetClass}&fromdate=${encodeURIComponent(first.date)}&todate=${encodeURIComponent(first.date)}&limit=2000`;
    HTTPClient.create()
        .request(makeNasdaqRequest(url))
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleOptionChain(resp.data, requests, resultDict);
            }
            if (hasResolvedAnyRequest(requests, resultDict) || index >= assetClasses.length - 1) {
                completion();
            } else {
                requestOptionGroupByAssetClass(requests, assetClasses, index + 1, resultDict, completion);
            }
        });
}

function requestByStocks(stocks, resultDict, completion) {
    let groups = {};
    for (const stock of stocks) {
        let request = parseOptionSymbol(stock.symbol);
        if (request == null) {
            continue;
        }

        let groupKey = `${request.underlying}_${request.date}`;
        if (groups[groupKey] == null) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(request);
    }

    let keys = Object.keys(groups);
    if (keys.length === 0) {
        completion();
        return;
    }

    let pending = keys.length;
    function finishOne() {
        pending--;
        if (pending === 0) {
            completion();
        }
    }

    for (const key of keys) {
        requestOptionGroup(key, groups[key], resultDict, finishOne);
    }
}

function getLatestPriceByStocks(stocks) {
    let resultDict = {};
    let noCachedStocks = [];

    for (const stock of stocks) {
        if (!isMyStock(stock)) {
            continue;
        }

        let symbol = `${stock.symbol}`.toUpperCase();
        let cachedValue = $cache.get(buildDailyCacheKey(symbol));
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

    requestByStocks(noCachedStocks, resultDict, function() {
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
